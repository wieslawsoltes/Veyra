import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
setMaxListeners(0);

class Classes {
  constructor(node) { this.node = node; }
  get values() { return new Set(this.node.className.split(/\s+/).filter(Boolean)); }
  contains(value) { return this.values.has(value); }
  add(...values) { const set = this.values; values.forEach(value => set.add(value)); this.node.className = [...set].join(' '); }
  remove(...values) { const set = this.values; values.forEach(value => set.delete(value)); this.node.className = [...set].join(' '); }
  toggle(value, force) { const added = force ?? !this.contains(value); if (added) this.add(value); else this.remove(value); return added; }
}
class Element extends EventTarget {
  constructor(tag) { super(); this.tagName=tag; this.children=[];this.parentElement=null;this.className='';this.attributes={};this.dataset={};this.style={setProperty(name,value){this[name]=value}};this.classList=new Classes(this);this.textContent='';this.width=140;this.height=82;this.hidden=false;this.value=''; }
  appendChild(child) { child.parentElement=this;this.children.push(child);return child; }
  append(...children) { children.forEach(child=>this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child=>child.parentElement=null);this.children=[];this.append(...children); }
  remove() { if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(child=>child!==this);this.parentElement=null;} }
  setAttribute(name,value) { this.attributes[name]=String(value);if(name==='class')this.className=String(value); }
  getAttribute(name) { return this.attributes[name]; }
  matches(selector) { return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('.'))return this.classList.contains(part.slice(1));if(part.startsWith('['))return false;return this.tagName===part;}); }
  closest(selector) { let current=this;while(current){if(current.matches(selector))return current;current=current.parentElement;}return null; }
  contains(other) { while(other){if(other===this)return true;other=other.parentElement;}return false; }
  querySelectorAll(selector) { return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
  get firstElementChild(){return this.children[0]||null;}
  get lastElementChild(){return this.children.at(-1)||null;}
  get clientWidth(){return this.classList.contains('vg-curve-stage')?800:1024;}
  get clientHeight(){return this.classList.contains('vg-curve-stage')?190:460;}
  get offsetWidth(){return 198;}
  get offsetHeight(){return 150;}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
  setPointerCapture(){}releasePointerCapture(){}focus(){}
  getContext(){return new Proxy({},{get(){return ()=>{}}});}
}
class Document extends EventTarget {
  constructor(){super();this.hit=null;this.body=new Element('body');}
  createElement(tag){return new Element(tag);}
  createElementNS(ns,tag){return new Element(tag);}
  elementFromPoint(){return this.hit;}
}
globalThis.document=new Document();globalThis.window=new EventTarget();globalThis.ResizeObserver=class{observe(){}disconnect(){}};
const {NodeGraph}=await import('../public/packages/controls/graph.js');
const {CurveEditor}=await import('../public/packages/controls/curve-editor.js');
const event=(target, props={})=>({target,button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){},stopPropagation(){},...props});
const nodes=[{id:'a',type:'Source',name:'<img src=x onerror=alert(1)>',x:0,y:0,inputs:[],params:{}},{id:'b',type:'Grade',name:'Grade',x:0,y:150,inputs:['a'],params:{gain:1},keyframes:{gain:[{frame:1,value:1,interpolation:'linear'},{frame:30,value:2,interpolation:'smooth'}]}},{id:'c',type:'Merge',name:'Merge',x:260,y:150,inputs:[null,null],params:{mix:1}}];
const updates=[];let selection=[];
const graph=new NodeGraph(new Element('div'),{
onSelect(ids){selection=ids;updates.push(['select',ids]);graph.setData(nodes,ids,'c')},
onMove(positions){updates.push(['move',positions]);positions.forEach(position=>Object.assign(nodes.find(node=>node.id===position.id),position));graph.setData(nodes,selection,'c')},
onConnect(a,b,index){updates.push(['connect',a,b,index]);nodes.find(node=>node.id===b).inputs[index]=a;graph.setData(nodes,selection,'c')},
onDisconnect(id,index){updates.push(['disconnect',id,index]);nodes.find(node=>node.id===id).inputs[index]=null;graph.setData(nodes,selection,'c')},
onAdd(point){updates.push(['add',point])},onView(id){updates.push(['view',id])},onDelete(ids){updates.push(['delete',ids])}
});
graph.setData(nodes,[],'c');
assert.equal(graph.nodeElements.size,3);
assert.equal(graph.edgeLayer.children.length,1);
assert.equal(graph.nodeElements.get('a').querySelector('.vg-node-name').textContent,nodes[0].name);
assert.equal(graph.nodeElements.get('a').querySelector('.vg-node-name').children.length,0);
assert.equal(graph.nodeElements.get('c').querySelector('.vg-inputs').children.length,2);
const scale=graph.scale,pan={...graph.pan};graph.setData(nodes,[],'c');assert.equal(graph.scale,scale);assert.deepEqual(graph.pan,pan);
const anchor={x:235,y:182},beforeZoom=graph._toWorld(anchor);graph._zoomTo(1.75,anchor);assert.deepEqual(graph._toWorld(anchor),beforeZoom);
graph._select(['a','b']);
graph._pointerDown(event(graph.nodeElements.get('a'),{clientX:20,clientY:20}));
graph._pointerMove(event(graph.root,{clientX:55,clientY:55}));
assert.equal(nodes[0].x,0,'Dragging must not mutate source objects');
graph._pointerUp({pointerId:1});
assert.equal(nodes[0].x,20);assert.equal(nodes[1].x,20);assert.equal(nodes[1].y,170);
assert.equal(updates.filter(update=>update[0]==='move').length,1);
graph._pointerDown(event(graph.root,{button:1,clientX:100,clientY:100}));const panBefore={...graph.pan};graph._pointerMove(event(graph.root,{clientX:150,clientY:120}));graph._pointerUp({pointerId:1});assert.equal(graph.pan.x,panBefore.x+50);
const output=graph.nodeElements.get('a').querySelector('.vg-output');const input=graph.nodeElements.get('c').querySelector('.vg-input');
graph._pointerDown(event(output,{clientX:1,clientY:1}));document.hit=input;graph._pointerMove(event(graph.root,{clientX:60,clientY:90}));graph._pointerUp({pointerId:1});assert.equal(nodes[2].inputs[0],'a');
graph._pointerDown(event(input,{altKey:true}));assert.equal(nodes[2].inputs[0],null);
graph._doubleClick(event(graph.nodeElements.get('b')));assert.equal(updates.at(-1)[0],'view');
graph._keyDown(event(graph.root,{key:'Tab'}));assert.equal(updates.at(-1)[0],'add');
graph._select(['a']);graph._keyDown(event(graph.root,{key:'Delete'}));assert.deepEqual(updates.at(-1),['delete',['a']]);
graph._contextMenu(event(graph.nodeElements.get('b'),{clientX:20,clientY:20}));assert.ok(graph.menu);assert.ok(graph.menu.querySelectorAll('.vg-menu-item').length>=3);graph._closeMenu();

let lastKeys;
const curve=new CurveEditor(new Element('div'),{onChange(keys){lastKeys=keys;nodes[1].keyframes=keys;curve.setData(nodes[1],10)}});
curve.setData(nodes[1],10);assert.equal(curve.params[0],'gain');assert.equal(curve.svg.querySelectorAll('.vg-curve-key').length,2);
curve.addKeyframe('gain',12,1.7);assert.equal(lastKeys.gain.length,3);assert.ok(lastKeys.gain.every(key=>key.interpolation));
lastKeys.gain[0].value=99;assert.notEqual(curve.keyframes.gain[0].value,99,'onChange must receive a defensive clone');
const key=curve.svg.querySelectorAll('.vg-curve-key')[1];curve._pointerDown(event(key,{clientX:60,clientY:80}));
curve._pointerMove(event(curve.stage,{clientX:80,clientY:70,shiftKey:true}));const movedValue=curve._selected().value;assert.equal(curve._selected().frame,12);
curve.setData({...nodes[1],keyframes:{gain:[{frame:1,value:0,interpolation:'linear'}]}},11);assert.equal(curve._selected().value,movedValue,'Frame updates must preserve in-progress key drags');
curve._pointerUp({pointerId:1});assert.equal(lastKeys.gain.length,3);
curve._editSelected({interpolation:'hold'});assert.equal(curve._selected().interpolation,'hold');
curve._deleteSelected();assert.equal(lastKeys.gain.length,2);
curve.setData({id:'empty',type:'Source',params:{}},1);assert.equal(curve.addButton.disabled,true);
graph.destroy();curve.destroy();assert.equal(graph.root.parentElement,null);assert.equal(curve.root.parentElement,null);
console.log('PASS: 28 DOM and state assertions across graph render, selection, group drag, pan/zoom, connection, disconnect, view, add/delete callbacks, context menu, keyframe creation, drag, interpolation, defensive cloning, and cleanup.');
