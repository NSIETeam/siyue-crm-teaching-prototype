/* Shared page shells extracted from the GitHub Pages frontend. Content is already escaped by each presenter. */
(function(root){
 'use strict';
 const course=({tabs='',toolbar='',filters='',table='',footer=''})=>`<div class="card">${tabs}<div class="pad">${toolbar}${filters}${table}<div class="data-bar">${footer}</div></div></div>`;
 const classes=({filters='',toolbar='',table='',footer=''})=>`<div class="card pad">${filters}${toolbar}${table}<div class="data-bar">${footer}</div></div>`;
 const students=({tabs='',toolbar='',filters='',table='',footer=''})=>`<div class="card">${tabs}<div class="pad">${toolbar}${filters}${table}<div class="data-bar">${footer}</div></div></div>`;
 const home=({actions='',metrics='',panels=''})=>`${actions}<div class="workflow-metrics">${metrics}</div><div class="home-columns">${panels}</div>`;
 root.SiyuePageLayouts={course,classes,students,home};
})(typeof window==='undefined'?globalThis:window);
