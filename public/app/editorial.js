import {evaluateNodeParams} from '../packages/core/index.js';
/** Isolate each active clip's graph and source time, including shared upstream nodes. */
export function buildEditorial(project,frame){
 const p={...project,nodes:[],viewerNodeId:null};const byId=new Map(project.nodes.map(n=>[n.id,n]));const active=[];
 for(const track of [...project.timeline.tracks].reverse()){
  if(track.kind!=='video'||track.muted)continue;
  for(const clip of track.clips){
   if(frame<clip.start||frame>=clip.start+clip.duration)continue;
   const localFrame=frame-clip.start+clip.in,cloned=new Map();
   const copyBranch=id=>{if(cloned.has(id))return cloned.get(id);const source=byId.get(id);if(!source)throw new Error('Missing clip composition node: '+id);const newId=`seq-${clip.id}-${id}`;cloned.set(id,newId);const inputs=source.inputs.map(input=>input?copyBranch(input):null);const params=evaluateNodeParams(source,localFrame);if(source.type==='Source')params.timeOffset=(params.timeOffset||0)+clip.in-clip.start;p.nodes.push({...source,id:newId,inputs,params,keyframes:{}});return newId};
   let input;if(clip.nodeId)input=copyBranch(clip.nodeId);else{input=`seq-source-${clip.id}`;p.nodes.push({id:input,type:'Source',name:clip.name,inputs:[],params:{assetId:clip.assetId,timeOffset:clip.in-clip.start,fit:'contain'},disabled:false});}active.push({input,opacity:clip.opacity??1});
  }
 }
 let output='seq-background';p.nodes.push({id:output,type:'Constant',name:'Sequence background',inputs:[],params:{color:'#000000',alpha:1},disabled:false});
 active.forEach((a,i)=>{const id=`seq-composite-${i}`;p.nodes.push({id,type:'Merge',name:'Sequence composite',inputs:[output,a.input,null],params:{mode:'over',mix:a.opacity},disabled:false});output=id;});p.viewerNodeId=output;return {project:p,viewerNodeId:output,frame};
}
