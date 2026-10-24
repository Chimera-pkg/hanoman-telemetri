"""Sanity check the two bundled Office templates (stdlib only). Run python tests/validate_templates.py."""
from pathlib import Path
from zipfile import ZipFile
import re
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
tests=[('report-template.docx','word/document.xml',['full_name','facts_intro','profiling_1','reporter_opinion','signed_date']),('subject-template.pptx','ppt/slides/slide3.xml',['name_upper','summary','events','affiliations','regions'])]
for name,part,markers in tests:
 path=ROOT/'public'/'templates'/name
 assert path.exists(), f'{name}: template missing'
 with ZipFile(path) as z:
  assert z.testzip() is None, f'{name}: corrupt ZIP'
  xml=z.read(part).decode()
  for marker in markers:assert '{{'+marker+'}}' in xml, f'{name}: missing marker {marker}'
  for member in z.namelist():
   if member.endswith('.xml') or member.endswith('.rels'):
    ET.fromstring(z.read(member))
  for partname in z.namelist():
   if (partname.startswith('word/') or partname.startswith('ppt/slides/')) and partname.endswith('.xml'):
    text=z.read(partname).decode()
    assert not re.search('DAHLAN TAMPUBOLON|Signal Analysis|HUMINT',text,re.I), f'{name}: stale source subject text in {partname}'
 print('PASS',name,len(z.namelist()),'entries')
