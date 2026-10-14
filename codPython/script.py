import argparse
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pypdfium2 as pdfium
from paddleocr import PaddleOCR

PDF_PATH = 'avarul.pdf'
OUTPUT_PATH = 'avarul.txt'
SCALE = 2  # scale=2 pentru o acuratețe bună la OCR

# Inițializate o singură dată per proces worker
_ocr = None
_pdf = None
_config = {}


def _init_worker(pdf_path, lang, cpu_threads, scale):
    """Rulează o dată la pornirea fiecărui worker: încarcă modelul și PDF-ul."""
    global _ocr, _pdf, _config
    _config = {'scale': scale}
    _pdf = pdfium.PdfDocument(pdf_path)
    _ocr = PaddleOCR(
        lang=lang,
        cpu_threads=cpu_threads,
        # Dezactivăm etapele suplimentare: pe un scan normal doar încetinesc
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


def _sort_reading_order(texts, boxes):
    """Ordonează liniile de sus în jos, apoi de la stânga la dreapta."""
    if not texts or boxes is None or len(boxes) != len(texts):
        return texts
    boxes = np.asarray(boxes).reshape(len(texts), -1)
    tops = boxes[:, 1]
    lefts = boxes[:, 0]
    heights = boxes[:, 3] - boxes[:, 1]
    tol = max(float(np.median(heights)) * 0.6, 1.0)
    order = sorted(range(len(texts)), key=lambda i: (round(tops[i] / tol), lefts[i]))
    return [texts[i] for i in order]


def process_single_page(page_num):
    """Randează pagina și extrage textul. Rulează în procesul worker."""
    texts = []
    try:
        image = _pdf[page_num].render(scale=_config['scale']).to_pil().convert('RGB')
        result = _ocr.predict(np.array(image))

        for page_result in result:
            # PaddleOCR 3.x întoarce obiecte de tip dict cu listele rec_texts / rec_boxes
            rec_texts = page_result.get('rec_texts') or []
            rec_boxes = page_result.get('rec_boxes')
            texts.extend(_sort_reading_order(list(rec_texts), rec_boxes))
    except Exception as exc:
        # O pagină problematică nu trebuie să oprească tot documentul
        print(f"EROARE la pagina {page_num + 1}: {exc}", flush=True)
        body = f"[eroare OCR: {exc}]"
    else:
        body = "\n".join(texts)
        print(f"Gata pagina {page_num + 1} ({len(texts)} linii)", flush=True)

    return page_num, f"=== PAGINA {page_num + 1} ===\n{body}\n\n"


def main():
    parser = argparse.ArgumentParser(description='Convertește un PDF scanat în text prin OCR.')
    parser.add_argument('pdf', nargs='?', default=PDF_PATH)
    parser.add_argument('-o', '--output', default=None)
    parser.add_argument('--pages', default='all',
                        help="Câte pagini: 'all', un număr (primele N) sau un interval '5-20'.")
    parser.add_argument('--lang', default='ro')
    parser.add_argument('--scale', type=float, default=SCALE)
    parser.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 4) // 2))
    args = parser.parse_args()

    output_path = args.output or os.path.splitext(args.pdf)[0] + '.txt'

    print("Deschidem PDF-ul...")
    pdf = pdfium.PdfDocument(args.pdf)
    total_pages = len(pdf)
    pdf.close()

    if args.pages == 'all':
        first, last = 0, total_pages - 1
    elif '-' in args.pages:
        start, end = args.pages.split('-', 1)
        first, last = int(start) - 1, int(end) - 1
    else:
        first, last = 0, int(args.pages) - 1
    first = max(0, first)
    last = min(last, total_pages - 1)
    if first > last:
        sys.exit(f"Interval de pagini invalid: {args.pages} (documentul are {total_pages} pagini)")

    page_range = range(first, last + 1)
    print(f"Documentul are {total_pages} pagini în total.")
    print(f"Se procesează paginile {first + 1}-{last + 1} pe {args.workers} procese...\n")

    # cpu_threads per worker, ca procesele să nu se bată pe aceleași nuclee
    cpu_threads = max(1, (os.cpu_count() or 4) // args.workers)
    init_args = (args.pdf, args.lang, cpu_threads, args.scale)

    results = {}
    with ProcessPoolExecutor(max_workers=args.workers,
                             initializer=_init_worker,
                             initargs=init_args) as executor:
        for page_num, text in executor.map(process_single_page, page_range):
            results[page_num] = text

    # Scriem rezultatele în fișier în ordinea corectă
    with open(output_path, 'w', encoding='utf-8') as f:
        for i in page_range:
            f.write(results[i])

    chars = sum(len(t) for t in results.values())
    print(f"\nFinalizat! {len(results)} pagini, {chars} caractere salvate în {output_path}")


if __name__ == '__main__':
    main()
