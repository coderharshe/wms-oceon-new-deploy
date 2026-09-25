import zipfile
import xml.etree.ElementTree as ET
import os
import sys

folder = r"e:\wms-2 with different deploys\updated id's"
files = [
    "OCEON ADMIN DASHBOARD.docx",
    "OCEON BILLING.docx",
    "OCEON FINANCE DASHBOARD.docx",
    "OCEON INVENTORY.docx",
    "OCEON MANAGER DASHBOARD.docx",
    "OCEON PROCUREMENT  PURCHASE MODULE.docx",
]

NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def extract_text(path):
    with zipfile.ZipFile(path) as z:
        with z.open('word/document.xml') as f:
            tree = ET.parse(f)
            root = tree.getroot()
            paragraphs = []
            for para in root.iter(NS + 'p'):
                texts = []
                for elem in para.iter(NS + 't'):
                    if elem.text:
                        texts.append(elem.text)
                line = ''.join(texts).strip()
                if line:
                    paragraphs.append(line)
            return paragraphs

out_path = r"e:\wms-2 with different deploys\docs_content.txt"
with open(out_path, 'w', encoding='utf-8') as out:
    for fname in files:
        path = os.path.join(folder, fname)
        out.write(f"\n{'='*80}\n")
        out.write(f"FILE: {fname}\n")
        out.write('='*80 + "\n")
        try:
            paras = extract_text(path)
            for p in paras:
                out.write(p + "\n")
        except Exception as e:
            out.write(f"ERROR: {e}\n")

print("Done! Written to docs_content.txt")
