import sys, json, os, re, numpy as np, cv2
from PIL import Image
from tesserocr import PyTessBaseAPI, PSM
from grid import lines
TD=os.path.join(os.path.dirname(os.path.abspath(__file__)),'tessdata')
tel=PyTessBaseAPI(path=TD,lang='tel',psm=PSM.SINGLE_LINE)
eng=PyTessBaseAPI(path=TD,lang='eng',psm=PSM.SINGLE_LINE)
def ocr(api,img,wl=None):
    img=cv2.resize(img,None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
    img=cv2.copyMakeBorder(img,20,20,20,20,cv2.BORDER_CONSTANT,value=(255,255,255))
    api.SetVariable('tessedit_char_whitelist',wl or '')
    api.SetImage(Image.fromarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB)))
    return api.GetUTF8Text().strip()
def cards(page_img):
    hy,vx=lines(page_img)
    g=cv2.imread(page_img)
    hy=[y for y in hy if y>=200]
    tops=[]; 
    for y in hy:
        if not tops or y-tops[-1]>20: tops.append(y)
    cols=[(77,448),(456,826),(834,1206)]
    for r in range(len(tops)-1):
        y0,y1=tops[r]+2,tops[r+1]
        if y1-y0<140: continue
        for (x0,x1) in cols:
            c=g[y0:y1,x0+2:x1]
            if (c<128).mean()<0.01: continue
            yield c
def R(c,x0,y0,x1,y1): return c[y0:y1,x0:x1]
def after_colon(c,y0,y1,xa=88,xb=125):
    g=cv2.cvtColor(c[y0:y1,xa:xb],cv2.COLOR_BGR2GRAY)<128
    cols=g.any(0)
    # first ink group in window = colon (narrow)
    xs=np.where(cols)[0]
    if not len(xs): return 104
    s0=xs[0]; e=s0
    while e+1<len(cols) and cols[e+1]: e+=1
    if e-s0<=5: return xa+e+3
    return 104
def parse(c):
    d={}
    d['serial_raw']=ocr(eng,R(c,118,3,165,24),'0123456789')
    d['part_raw']=ocr(eng,R(c,240,3,371,24),'0123456789- ')
    d['name_raw']=ocr(tel,R(c,after_colon(c,33,52),33,285,52))
    d['rel_label']=ocr(tel,R(c,0,60,70,79))
    d['rel_raw']=ocr(tel,R(c,after_colon(c,59,79),59,285,79))
    d['age_raw']=ocr(eng,R(c,after_colon(c,86,104),86,140,104),'0123456789')
    gr=R(c,222,84,280,106); d['gender_raw']=ocr(tel,gr); gb=(cv2.cvtColor(gr,cv2.COLOR_BGR2GRAY)<60); xs=np.where(gb.any(0))[0]; d['g_w']=int(xs.max()-xs.min()) if len(xs) else 0
    d['house_raw']=ocr(eng,R(c,after_colon(c,111,129),111,285,129),'0123456789-/.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ')
    d['epic_raw']=ocr(eng,R(c,138,136,285,155),'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    return d
if __name__=='__main__':
    out=[]; outdir=sys.argv[2]; os.makedirs(outdir+'/photos',exist_ok=True)
    pages=[int(x) for x in sys.argv[1].split(',')]
    for p in pages:
        f='raw/img-%03d.jpg'%(2*p-1)
        for i,c in enumerate(cards(f)):
            d=parse(c); d['page']=p; d['idx']=i
            ph=R(c,280,58,371,152)
            d['photo']=f'p{p:02d}_{i:02d}.jpg'
            cv2.imwrite(f'{outdir}/photos/'+d['photo'],ph,[cv2.IMWRITE_JPEG_QUALITY,85])
            out.append(d)
        print('page',p,file=sys.stderr)
    json.dump(out,open(f'{outdir}/raw_{pages[0]}.json','w'),ensure_ascii=False,indent=0)
