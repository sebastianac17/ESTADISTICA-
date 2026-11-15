import numpy as np
from PIL import Image, ImageFilter, ImageDraw
rng=np.random.default_rng(7)
# seamless grass tile 256x128 with vertical blade streaks
W,H=256,128
n=rng.normal(0,1,(H,W))
def wblur(a,kx,ky):
    out=a.copy()
    for _ in range(ky): out=(np.roll(out,1,0)+out+np.roll(out,-1,0))/3
    for _ in range(kx): out=(np.roll(out,1,1)+out+np.roll(out,-1,1))/3
    return out
blades=wblur(n,0,4)*1.0+wblur(rng.normal(0,1,(H,W)),1,1)*0.6
coarse=wblur(rng.normal(0,1,(H,W)),10,10)*6
t=blades*0.55+coarse*0.5
t=(t-t.mean())/t.std()
base=np.array([44,128,56],float)
col=base[None,None,:]*(1+0.085*t[...,None])
col[...,0]+= 6*np.clip(coarse,0,None)/3   # slight yellowing patches
col=np.clip(col,0,255).astype(np.uint8)
Image.fromarray(col,'RGB').save('grass.webp',quality=80,method=6)
# crowd strip tile 360x40
CW,CH=360,40
img=Image.new('RGB',(CW*3,CH*3),(14,26,18)); d=ImageDraw.Draw(img)
cols=[(255,209,0),(255,214,40),(0,132,61),(0,110,50),(240,240,235),(30,60,40),(200,170,30),(20,40,28)]
wts=np.array([.22,.08,.2,.1,.12,.12,.06,.1]); wts/=wts.sum()
for row in range(5):
    y=row*26+18
    x=-20+(row%2)*14
    while x<CW*3+20:
        c=cols[rng.choice(len(cols),p=wts)]
        sh=tuple(int(v*0.82) for v in c)
        hx=x+rng.integers(-3,4); hy=y+rng.integers(-3,3)
        d.ellipse([hx-13,hy+8,hx+13,hy+40],fill=sh)        # shoulders
        skin=[(196,150,110),(150,105,70),(110,75,50),(220,180,140)][rng.integers(0,4)]
        d.ellipse([hx-6,hy-4,hx+6,hy+9],fill=skin)          # head
        if rng.random()<.25: d.rectangle([hx-9,hy-16,hx-6,hy+2],fill=c)  # raised arm
        x+=rng.integers(22,30)
img=img.filter(ImageFilter.GaussianBlur(1.2)).resize((CW,CH),Image.LANCZOS)
# make seamless horizontally by crossfade edges
a=np.array(img).astype(float); k=30
for i in range(k):
    t_=i/k; a[:,i]=a[:,i]*t_+a[:,-k+i]*(1-t_)
a=a[:,:-k]
Image.fromarray(a.astype(np.uint8)).save('crowd.webp',quality=78,method=6)
import os; print(os.path.getsize('grass.webp'),os.path.getsize('crowd.webp'), a.shape)
