import sys, numpy as np, cv2
def lines(path):
    g=cv2.imread(path,0)
    b=(g<140).astype(np.uint8)
    h=cv2.morphologyEx(b,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(200,1)))
    v=cv2.morphologyEx(b,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,120)))
    hy=np.where(h.sum(1)>300)[0]; vx=np.where(v.sum(0)>300)[0]
    def grp(a):
        out=[];
        for x in a:
            if out and x-out[-1][-1]<=3: out[-1].append(x)
            else: out.append([x])
        return [int(np.mean(o)) for o in out]
    return grp(hy),grp(vx)
if __name__=='__main__':
    for p in sys.argv[1:]:
        print(p,lines(p))
