// Presentation geometry only. Every cable endpoint is assigned a distinct
// attachment on the corresponding side of the device, INCLUDING connections
// to different neighbours. The socket/NIC indices are never modified here.
const LEFT=-1, RIGHT=1;
const FACE_HALF_X=38, FACE_HALF_Y=29;
const NODE_CX=49, NODE_CY=37;

export function deviceCenter(node){return {x:node.x+NODE_CX,y:node.y+NODE_CY};}
export function attachmentSide(node,other){
  const a=deviceCenter(node),b=deviceCenter(other),dx=b.x-a.x,dy=b.y-a.y;
  // Normalise for the dimensions of a device icon so diagonal connections
  // attach to the most appropriate edge instead of all using its right side.
  return Math.abs(dx)/49>=Math.abs(dy)/47?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
}
export function anchorFor(node,target){
  const c=deviceCenter(node),dx=target.x-c.x,dy=target.y-c.y;
  if(Math.abs(dx)/49>=Math.abs(dy)/47)return {x:c.x+(dx>=0?50:-50),y:c.y};
  return {x:c.x,y:c.y+(dy>=0?68:-36)};
}
function sideAnchor(node,side,slot,total){
  const c=deviceCenter(node);
  const wide=side==='top'||side==='bottom';
  const half=wide?FACE_HALF_X:FACE_HALF_Y;
  const spacing=total>1?Math.min(15,(2*half)/(total-1)):0;
  const offset=(slot-(total-1)/2)*spacing;
  switch(side){
    case 'left':return {x:c.x-50,y:c.y+offset};
    case 'right':return {x:c.x+50,y:c.y+offset};
    case 'top':return {x:c.x+offset,y:c.y-36};
    default:return {x:c.x+offset,y:c.y+68}; // below the device caption
  }
}
export function layoutParallelCables(lab){
  const nodes=new Map((lab.nodes||[]).map(n=>[n.id,n]));
  const records=new Map(),groups=new Map();
  for(const link of lab.links||[]){
    const a=nodes.get(link.a),b=nodes.get(link.b);
    if(!a||!b)continue;
    const first={node:a,other:b,side:attachmentSide(a,b),port:link.aPort,linkId:link.id,end:'A'};
    const second={node:b,other:a,side:attachmentSide(b,a),port:link.bPort,linkId:link.id,end:'B'};
    records.set(link.id,{first,second});
    for(const endpoint of [first,second]){
      const key=`${endpoint.node.id}:${endpoint.side}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(endpoint);
    }
  }
  // Sort by the projected position of the neighbour, then interface index.
  // Grouping by all links touching an edge avoids repeated attachment points
  // when a switch has cables to many different devices.
  for(const endpoints of groups.values()){
    const vertical=endpoints[0].side==='left'||endpoints[0].side==='right';
    endpoints.sort((a,b)=>{
      const pa=deviceCenter(a.other),pb=deviceCenter(b.other);
      const projection=(vertical?pa.y-pb.y:pa.x-pb.x);
      // The same cable must occupy the same rank at *both* devices.
      // Sorting by the local NIC index would reverse the bundle when the
      // port assignment is crossed (e.g. eth0->ether3, eth1->ether1).
      // The shared, stable link ID is independent of port numbers and A/B order.
      return projection||String(a.linkId).localeCompare(String(b.linkId));
    });
    endpoints.forEach((end,i)=>{end.point=sideAnchor(end.node,end.side,i,endpoints.length);end.slot=i;end.sideCount=endpoints.length;});
  }
  const result=new Map();
  for(const [id,{first,second}] of records){
    const A=first.point,B=second.point;
    result.set(id,{A,B,slot:first.slot,total:first.sideCount,sideA:first.side,sideB:second.side});
  }
  return result;
}

function badgeBox(x,y,width,height){return {left:x-width/2,right:x+width/2,top:y-height/2,bottom:y+height/2};}
function intersectArea(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}

/**
 * Labels belong to their own cable, not to the free space next to it.
 * A badge's center is constrained to the exact A--B segment: it can move
 * forward/back along that wire to avoid other labels, never sideways.
 * Keep this pure: the SVG editor and PNG exporter must share this layout.
 */
export function layoutPortBadges(lab,links,portName){
 const nodes=new Map((lab.nodes||[]).map(n=>[n.id,n]));
 const occupied=[];
 const nodeBoxes=(lab.nodes||[]).map(n=>({left:n.x-3,right:n.x+101,top:n.y-4,bottom:n.y+104}));
 const labels=new Map();
 const items=[];
 for(const link of lab.links||[]){
  const geo=links.get(link.id),a=nodes.get(link.a),b=nodes.get(link.b);
  if(!geo||!a||!b)continue;
  items.push({id:link.id,end:'a',point:geo.A,other:geo.B,name:String(portName(a,link.aPort))});
  items.push({id:link.id,end:'b',point:geo.B,other:geo.A,name:String(portName(b,link.bPort))});
 }
 // Stable order makes placement independent of API link ordering.
 items.sort((a,b)=>a.id.localeCompare(b.id)||a.end.localeCompare(b.end));
 for(const item of items){
  const {point,other,name}=item,dx=other.x-point.x,dy=other.y-point.y;
  const len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
  const width=Math.max(35,name.length*6.35+13),height=18;
  // Never move the centre past the opposite endpoint. Reserve some free cable
  // between two endpoint labels when the link has enough length.
  const maxAlong=Math.max(1,Math.min(len*.49,len-1));
  const nominal=Math.min(30,maxAlong);
  const candidates=[nominal,42,54,68,82,100,125,150,Math.min(len*.35,maxAlong),Math.min(len*.45,maxAlong)]
    .map(v=>Math.max(1,Math.min(maxAlong,v))).filter((v,i,arr)=>arr.findIndex(x=>Math.abs(x-v)<.5)===i);
  let best=null,score=Infinity;
  for(const along of candidates){
   // IMPORTANT: no normal vector component: badge stays on the cable.
   const x=point.x+ux*along,y=point.y+uy*along;
   const rect=badgeBox(x,y,width,height);
   const overlap=occupied.reduce((sum,o)=>sum+intersectArea(rect,o)*35,0);
   const nodeOverlap=nodeBoxes.reduce((sum,o)=>sum+intersectArea(rect,o)*20,0);
   const cost=overlap+nodeOverlap+Math.abs(along-nominal)*.32;
   if(cost<score){score=cost;best={x,y,width,height};}
  }
  occupied.push(badgeBox(best.x,best.y,width,height));
  const result=labels.get(item.id)||{};result[item.end]=best;labels.set(item.id,result);
 }
 return labels;
}
