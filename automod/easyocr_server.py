import sys, json, os, tempfile, base64, io
import easyocr
from PIL import Image, ImageEnhance, ImageFilter as PILFilter
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

reader = easyocr.Reader(['vi'], gpu=False, verbose=False)
debug_dir = os.path.join(tempfile.gettempdir(), 'easyocr_debug')
os.makedirs(debug_dir, exist_ok=True)

def preprocess(path):
    img = Image.open(path)
    w, h = img.size
    # Upscale small images 3-6x
    scale = max(3, min(6, 1200 // min(w, h)))
    if scale > 1:
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    # Grayscale + contrast + sharpen
    if img.mode != 'L':
        img = img.convert('L')
    img = ImageEnhance.Contrast(img).enhance(2.0)
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
        results = reader.readtext(pp, detail=1, paragraph=False,
                                  text_threshold=0.5, low_text=0.3)
        if os.path.exists(pp):
            os.unlink(pp)
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
    seen = set()
    texts = []
    for _, text, _ in results:
        text = text.strip()
        if text and len(text) >= 2 and text not in seen:
            seen.add(text)
            texts.append(text)
    return texts

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
            texts = ocr_image(img_data)
            sys.stderr.write(f'[easyocr] OCR done: {len(texts)} blocks\n')
            sys.stderr.flush()
            out = json.dumps({'texts': texts, 'count': len(texts)}, ensure_ascii=False)
            sys.stdout.write(out + '\n')
        elif cmd.get('action') == 'ping':
            sys.stdout.write(json.dumps({'pong': True}) + '\n')
        else:
            sys.stdout.write(json.dumps({'error': 'unknown action'}) + '\n')
    except Exception as e:
        err = {'error': str(e), 'type': type(e).__name__}
        sys.stderr.write(f'[easyocr] error: {e}\n')
        sys.stderr.flush()
        sys.stdout.write(json.dumps(err, ensure_ascii=False) + '\n')
    sys.stdout.flush()
