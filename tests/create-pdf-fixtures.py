"""Synthetic fixtures, not a real university export or a claim of full coverage."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw

root=Path(__file__).parent/'fixtures'/'pdf'
root.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
width,height=landscape(A4)
c=canvas.Canvas(str(root/'synthetic-chinese-timetable.pdf'),pagesize=(width,height))
c.setTitle('Synthetic Chinese timetable - two pages')
def page(number,courses):
    c.setFont('STSong-Light',16);c.drawString(40,height-35,'清课 PDF 导入合成样例（非真实学校课表）')
    c.setFont('STSong-Light',10)
    xs=[110+i*97 for i in range(7)]
    for x,day in zip(xs,'一二三四五六日'):c.drawString(x,height-70,'星期'+day)
    c.setStrokeColorRGB(.7,.75,.7)
    for x in [95+i*97 for i in range(8)]:c.line(x,height-80,x,90)
    for y in [height-80,height-210,height-340,90]:c.line(95,y,95+7*97,y)
    for day,top,lines in courses:
        for i,line in enumerate(lines):c.drawString(xs[day-1]-5,height-top-i*15,line)
    c.setFont('STSong-Light',9);c.drawString(40,40,'仅用于离线解析测试：含中文、单双周、页间重复课程。')
    c.drawRightString(width-40,40,str(number));c.showPage()
math=(1,105,['高等数学','第1-2节 1-16周(单)','教师：王老师','教室：A201'])
page(1,[math,(3,105,['大学英语','第3-4节 2-16周(双)','教师：李老师','教室：B302'])])
page(2,[math,(5,240,['大学体育','第7-8节 1-18周','教师：赵老师','教室：操场'])])
c.save()
image=Image.new('RGB',(700,400),'white');draw=ImageDraw.Draw(image);draw.text((40,50),'Scanned timetable fixture - no text layer',fill='black')
c=canvas.Canvas(str(root/'synthetic-scan.pdf'),pagesize=A4);c.drawImage(ImageReader(image),30,400,width=520,height=300);c.save()
print(root)
