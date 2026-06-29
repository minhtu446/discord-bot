import sys, json, os, tempfile, shutil, traceback, warnings, io

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
warnings.filterwarnings("ignore")

def process(audio_path):
    result = {"text": ""}
    try:
        old_stderr = sys.stderr
        sys.stderr = io.StringIO()
        try:
            from demucs import separate
            out_dir = tempfile.mkdtemp(prefix="demucs_")
            try:
                separate.main(["--two-stems=vocals", "-o", out_dir, "--device", "cpu", audio_path])
                base = os.path.splitext(os.path.basename(audio_path))[0]
                vocal_file = None
                for p in [
                    os.path.join(out_dir, "htdemucs", base, "vocals.wav"),
                    os.path.join(out_dir, "demucs", base, "vocals.wav"),
                ]:
                    if os.path.exists(p):
                        vocal_file = p
                        break
                if vocal_file and os.path.getsize(vocal_file) > 0:
                    from faster_whisper import WhisperModel
                    model = WhisperModel("base", device="cpu", compute_type="int8")
                    segments, _ = model.transcribe(vocal_file, language="vi", beam_size=3)
                    texts = [s.text for s in segments]
                    result["text"] = " ".join(texts).strip()
            finally:
                if os.path.exists(out_dir):
                    shutil.rmtree(out_dir, ignore_errors=True)
        finally:
            sys.stderr = old_stderr
    except:
        result["error"] = traceback.format_exc()
    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no input"}), flush=True)
        sys.exit(1)
    r = process(sys.argv[1])
    print(json.dumps(r), flush=True)
