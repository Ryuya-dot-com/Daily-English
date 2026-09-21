import csv
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build import catalog


class CatalogTests(unittest.TestCase):
    def test_csv_updates_and_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            fields = ["id", "section", "section_title", "japanese", "english", "note"]

            def write(name, rows):
                with (folder / name).open("w", encoding="utf-8-sig", newline="") as stream:
                    writer = csv.writer(stream)
                    writer.writerow(fields)
                    writer.writerows(rows)

            row = ["S001", "01", "朝", "おはよう。", 'Good morning, "Sam".', ""]
            write("one.csv", [row])
            first = catalog(folder)
            item = first["sections"][0]["sentences"][0]
            self.assertEqual(item["english"], row[4])
            write("two.csv", [["S078", "05", "昼", "こんにちは。", "Hello.", ""]])
            self.assertEqual(len(catalog(folder)["sections"]), 2)
            row[4] = "Morning!"
            write("one.csv", [row])
            self.assertNotEqual(catalog(folder)["sections"][0]["sentences"][0]["audio"], item["audio"])
            write("two.csv", [row])
            with self.assertRaisesRegex(ValueError, "duplicate"):
                catalog(folder)
            (folder / "two.csv").unlink()
            row[0] = "../outside"
            write("one.csv", [row])
            with self.assertRaisesRegex(ValueError, "invalid"):
                catalog(folder)
            row[0], row[4] = "S001", ""
            write("one.csv", [row])
            with self.assertRaisesRegex(ValueError, "empty"):
                catalog(folder)


if __name__ == "__main__":
    unittest.main()
