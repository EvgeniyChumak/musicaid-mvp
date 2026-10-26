import json
import math
import wave
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
FIXTURES_ROOT = BACKEND_ROOT / "fixtures" / "audio"


def test_audio_fixture_manifest_has_known_scenarios() -> None:
    manifest = json.loads((FIXTURES_ROOT / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["sample_rate_hz"] == 22_050
    assert manifest["channels"] == 1
    assert len(manifest["fixtures"]) == 30
    assert manifest["references"]["titanic-theme"].endswith("titanic-theme-easy.mid")
    assert manifest["references"]["californication-guitar"].endswith("californication-guitar-easy.mid")

    errors_by_file = {
        fixture["file"]: {error["type"] for error in fixture["expected_errors"]}
        for fixture in manifest["fixtures"]
    }
    assert errors_by_file["jingle-bells-perfect.wav"] == set()
    assert errors_by_file["jingle-bells-slower.wav"] == {"tempo_change"}
    assert errors_by_file["jingle-bells-transposed.wav"] == {"transposition"}
    assert errors_by_file["jingle-bells-partial.wav"] == {"partial_performance"}
    assert errors_by_file["jingle-bells-overplayed.wav"] == {"overplayed"}
    assert errors_by_file["jingle-bells-wrong-note.wav"] == {"wrong_pitch"}
    assert errors_by_file["jingle-bells-late-note.wav"] == {"late_note"}
    assert errors_by_file["jingle-bells-mixed-errors.wav"] == {
        "wrong_pitch",
        "missed_note",
        "late_note",
        "extra_note",
    }
    assert errors_by_file["jingle-bells-very-poor.wav"] == {"wrong_pitch"}
    assert errors_by_file["twinkle-twinkle-unrelated.wav"] == {"unrelated_piece"}
    assert errors_by_file["titanic-perfect.wav"] == set()
    assert errors_by_file["titanic-slower.wav"] == {"tempo_change"}
    assert errors_by_file["titanic-transposed.wav"] == {"transposition"}
    assert errors_by_file["titanic-partial.wav"] == {"partial_performance"}
    assert errors_by_file["titanic-overplayed.wav"] == {"overplayed"}
    assert errors_by_file["titanic-wrong-note.wav"] == {"wrong_pitch"}
    assert errors_by_file["titanic-late-note.wav"] == {"late_note"}
    assert errors_by_file["titanic-mixed-errors.wav"] == {
        "wrong_pitch",
        "missed_note",
        "late_note",
        "extra_note",
    }
    assert errors_by_file["titanic-very-poor.wav"] == {"wrong_pitch"}
    assert errors_by_file["titanic-other-melody.wav"] == {"unrelated_piece"}
    assert errors_by_file["californication-perfect.wav"] == set()
    assert errors_by_file["californication-slower.wav"] == {"tempo_change"}
    assert errors_by_file["californication-transposed.wav"] == {"transposition"}
    assert errors_by_file["californication-partial.wav"] == {"partial_performance"}
    assert errors_by_file["californication-overplayed.wav"] == {"overplayed"}
    assert errors_by_file["californication-wrong-note.wav"] == {"wrong_pitch"}
    assert errors_by_file["californication-late-note.wav"] == {"late_note"}
    assert errors_by_file["californication-mixed-errors.wav"] == {
        "wrong_pitch", "missed_note", "late_note", "extra_note",
    }
    assert errors_by_file["californication-very-poor.wav"] == {"wrong_pitch"}
    assert errors_by_file["californication-other-melody.wav"] == {"unrelated_piece"}


def test_generated_wav_files_are_valid_mono_pcm() -> None:
    manifest = json.loads((FIXTURES_ROOT / "manifest.json").read_text(encoding="utf-8"))

    for fixture in manifest["fixtures"]:
        path = FIXTURES_ROOT / fixture["file"]
        assert path.exists()
        with wave.open(str(path), "rb") as wav_file:
            assert wav_file.getnchannels() == 1
            assert wav_file.getsampwidth() == 2
            assert wav_file.getframerate() == 22_050
            assert math.isclose(
                wav_file.getnframes() / wav_file.getframerate(),
                fixture["duration_seconds"],
                abs_tol=1 / wav_file.getframerate(),
            )
