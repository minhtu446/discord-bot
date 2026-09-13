import sys, json, os, tempfile, base64, io, logging
from PIL import Image, ImageEnhance, ImageFilter as PILFilter
import numpy as np

logging.disable(logging.CRITICAL)

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

debug_dir = os.path.join(tempfile.gettempdir(), 'ocr_debug')
os.makedirs(debug_dir, exist_ok=True)

_paddle = None
_paddle_error = None
_paddle_initialized = False

def get_paddle_reader():
    global _paddle, _paddle_error, _paddle_initialized
    if _paddle_initialized:
        return _paddle, _paddle_error
    _paddle_initialized = True
    old_stdout = sys.stdout
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    try:
        from paddleocr import PaddleOCR
        _paddle = PaddleOCR(lang='vi')
    except Exception as e:
        _paddle = None
        _paddle_error = str(e)
        sys.stderr.write(f'[ocr] PaddleOCR init failed: {e}\n')
    finally:
        try:
            sys.stdout.close()
        except Exception:
            pass
        sys.stdout = old_stdout
    sys.stderr.flush()
    return _paddle, _paddle_error

def run_paddle(path):
    reader, err = get_paddle_reader()
    if reader is None:
        return None, err
    try:
        if hasattr(reader, 'predict'):
            try:
                result = reader.predict(path)
            except (TypeError, AttributeError):
                result = None
        else:
            result = None
        if result is None:
            try:
                result = reader.ocr(path, cls=True)
            except TypeError:
                result = reader.ocr(path)
        blocks = []
        if not result:
            return [], None
        for item in result:
            if isinstance(item, dict):
                texts = item.get('rec_texts') or []
                scores = item.get('rec_scores') or []
                for idx, t in enumerate(texts):
                    conf = scores[idx] if idx < len(scores) else 0.0
                    blocks.append((str(t).strip(), float(conf)))
            elif isinstance(item, (list, tuple)):
                for seg in item:
                    if (isinstance(seg, (list, tuple)) and len(seg) >= 2
                            and isinstance(seg[0], (list, tuple)) and isinstance(seg[1], (list, tuple))):
                        text, conf = seg[1][0], seg[1][1]
                        blocks.append((str(text).strip(), float(conf)))
        return blocks, None
    except Exception as e:
        return None, f'PaddleOCR: {e}'

def run_tesseract(path):
    try:
        import pytesseract
        from PIL import Image
        lang = 'vie'
        text = pytesseract.image_to_string(Image.open(path), lang=lang)
        blocks = [t.strip() for t in text.splitlines() if t.strip()]
        return blocks, None
    except Exception as e:
        return None, f'Tesseract: {e}'

def preprocess(path):
    img = Image.open(path)
    w, h = img.size
    min_side = min(w, h)
    scale = max(1, min(3, 500 // max(min_side, 1)))
    if scale > 1:
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    if img.mode != 'L':
        img = img.convert('L')
    img = ImageEnhance.Contrast(img).enhance(1.5)
    img = img.filter(PILFilter.SHARPEN)
    pp = path + '_pp.png'
    img.save(pp)
    return pp

def ocr_image(img_data):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
    try:
        tmp.write(img_data)
        tmp.close()
        pp = preprocess(tmp.name)
        blocks, paddle_err = run_paddle(pp)
        engine = 'paddle'
        if blocks is None:
            texts, tess_err = run_tesseract(pp)
            engine = 'tesseract'
            if texts is None:
                raise RuntimeError(paddle_err or tess_err)
            result = texts
        else:
            result = [t for t, c in blocks if c >= 0.45]
        if os.path.exists(pp):
            os.unlink(pp)
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
    seen = set()
    texts = []
    for text in result:
        text = text.strip()
        if text and len(text) >= 2 and text not in seen:
            seen.add(text)
            texts.append(text)
    return texts, engine

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        cmd = json.loads(line)
        if cmd.get('action') == 'ocr':
            img_data = base64.b64decode(cmd['image'])
            debug_path = os.path.join(debug_dir, 'last_ocr.png')
            with open(debug_path, 'wb') as f:
                f.write(img_data)
            texts, engine = ocr_image(img_data)
            sys.stderr.write(f'[ocr] {engine} OCR done: {len(texts)} blocks\n')
            sys.stderr.flush()
            out = json.dumps({'texts': texts, 'count': len(texts), 'engine': engine}, ensure_ascii=False)
            sys.stdout.write(out + '\n')
        elif cmd.get('action') == 'ping':
            sys.stdout.write(json.dumps({'pong': True}) + '\n')
        else:
            sys.stdout.write(json.dumps({'error': 'unknown action'}) + '\n')
    except Exception as e:
        err = {'error': str(e), 'type': type(e).__name__}
        sys.stderr.write(f'[ocr] error: {e}\n')
        sys.stderr.flush()
        sys.stdout.write(json.dumps(err, ensure_ascii=False) + '\n')
    sys.stdout.flush()