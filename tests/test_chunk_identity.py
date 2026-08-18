from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

from mempalace_dashboard import server


class ChunkIdentityTests(unittest.TestCase):
    """Keep Chroma's physical chunk representation out of dashboard state."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._patches = ExitStack()
        self.addCleanup(self._patches.close)
        self.db = Path(self._tmp.name) / "chroma.sqlite3"
        self._patches.enter_context(mock.patch.object(server, "PALACE_DB", self.db))
        self._patches.enter_context(mock.patch.object(server, "PALACE_PREVIEW_CHARS", 8))
        self._patches.enter_context(mock.patch.object(server, "enrich_drawers_with_updated_at"))
        self._create_db()

    def _create_db(self) -> None:
        con = sqlite3.connect(self.db)
        con.executescript("""
            create table embeddings (id integer primary key, embedding_id text not null);
            create table embedding_metadata (
                id integer not null,
                key text not null,
                string_value text,
                int_value integer,
                float_value real,
                bool_value integer
            );
        """)
        # Deliberately store chunk 1 before chunk 0: dashboard order must use
        # the chunk suffix, not Chroma's internal row id.
        con.executemany("insert into embeddings values (?, ?)", [
            (10, "drawer_story_chunk_000001"),
            (11, "drawer_story_chunk_000000"),
            (12, "drawer_normal"),
        ])
        metadata = [
            (10, "chroma:document", "world", None, None, None),
            (10, "wing", "archive", None, None, None),
            (10, "room", "stories", None, None, None),
            (11, "chroma:document", "# Hello\n", None, None, None),
            (11, "wing", "archive", None, None, None),
            (11, "room", "stories", None, None, None),
            (11, "source_file", "import.md", None, None, None),
            (12, "chroma:document", "# Normal\n\nbody", None, None, None),
            (12, "wing", "notes", None, None, None),
            (12, "room", "general", None, None, None),
        ]
        con.executemany("insert into embedding_metadata values (?, ?, ?, ?, ?, ?)", metadata)
        con.commit()
        con.close()

    def test_list_groups_chunks_as_one_logical_drawer(self) -> None:
        drawers = server.read_drawers()

        self.assertEqual([drawer["drawer_id"] for drawer in drawers], ["drawer_story", "drawer_normal"])
        story = drawers[0]
        self.assertEqual(story["content"], "# Hello\nworld")
        self.assertEqual(story["title"], "Hello")
        self.assertEqual(story["wing"], "archive")
        self.assertEqual(story["source_file"], "import.md")
        self.assertEqual(story["etag"], server.content_etag("# Hello\nworld"))

    def test_lazy_read_search_and_delete_scope_keep_parent_identity(self) -> None:
        # A hit on the second physical row must return both chunks as the
        # logical parent, otherwise opening the search result loses content.
        matched = server.read_drawers(light=True, ids=[10])
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["drawer_id"], "drawer_story")
        self.assertEqual(matched[0]["content"], "# Hello\n")
        self.assertTrue(matched[0]["truncated"])

        drawer = server.read_single_drawer("drawer_story")
        self.assertIsNotNone(drawer)
        self.assertEqual(drawer["drawer_id"], "drawer_story")
        self.assertEqual(drawer["content"], "# Hello\nworld")
        self.assertFalse(drawer["truncated"])

        label, targets = server.drawers_for_delete({"scope": "drawer", "drawer_id": "drawer_story"})
        self.assertEqual(label, "memory")
        self.assertEqual([target["drawer_id"] for target in targets], ["drawer_story"])

        with (
            mock.patch.object(server, "mempalace_update_drawer", return_value={"success": True}) as update,
            mock.patch.object(server, "_mark_drawer_self_seen"),
        ):
            server.update_memory({
                "drawer_id": "drawer_story",
                "content": "# Hello\nupdated world",
                "etag": drawer["etag"],
            })
        update.assert_called_once_with("drawer_story", "# Hello\nupdated world", None, None)

        with (
            mock.patch.object(server, "mempalace_delete_drawer", return_value={"success": True}) as delete,
            mock.patch.object(server, "log_version"),
        ):
            server.delete_memories({"scope": "drawer", "drawer_id": "drawer_story", "confirm": "DELETE"})
        delete.assert_called_once_with("drawer_story")


if __name__ == "__main__":
    unittest.main()
