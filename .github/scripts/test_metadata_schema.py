"""Validate supported attribution without relaxing unknown-field rejection."""
import copy
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]


class MetadataSchemaTests(unittest.TestCase):
    def setUp(self):
        self.metadata = json.loads((ROOT / "extensions/professional-crm/metadata.json").read_text())
        schema = json.loads((ROOT / ".github/metadata.schema.json").read_text())
        Draft202012Validator.check_schema(schema)
        self.validator = Draft202012Validator(schema)

    def test_existing_attribution_and_primary_author_are_valid(self):
        self.validator.validate(self.metadata)
        without_contributors = copy.deepcopy(self.metadata)
        without_contributors.pop("contributors")
        self.validator.validate(without_contributors)

    def test_unknown_fields_and_malformed_contributors_remain_invalid(self):
        for contributors in ["someone", [{}], [{"name": ""}], [{"name": "A", "unexpected": True}]]:
            metadata = copy.deepcopy(self.metadata)
            metadata["contributors"] = contributors
            self.assertTrue(list(self.validator.iter_errors(metadata)))
        metadata = copy.deepcopy(self.metadata)
        metadata["unknown"] = True
        self.assertTrue(list(self.validator.iter_errors(metadata)))


if __name__ == "__main__":
    unittest.main()
