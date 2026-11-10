const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
test('library covers render the original first PDF page sharply, without enlarging a 150px jpeg',()=>{
 const reader=read('app-v2.js');
 const start=reader.indexOf('async function drawLibraryCovers()');
 const end=reader.indexOf('function openLibraryDocument(',start);
 assert.ok(start>0&&end>start);
 const fragment=reader.slice(start,end);
 assert.match(fragment,/pdfFile\.getPage\(1\)/);
 assert.match(fragment,/maxWidth=560,maxHeight=860/);
 assert.match(fragment,/Math\.min\(maxWidth\/base\.width,maxHeight\/base\.height\)/);
 assert.match(fragment,/canvas\.toDataURL\("image\/png"\)/);
 assert.doesNotMatch(fragment,/150\/base\.width|image\/jpeg|\.toDataURL\("image\/jpeg"/);
 assert.match(reader,/IntersectionObserver/);
 assert.match(reader,/libraryThumbCache/);
});
test('responsive grid and continuation covers show entire page instead of object-fit crop',()=>{
 const css=read('style.css');
 assert.match(css,/\.library-page \.library-cards \.library-cover-image/);
 assert.match(css,/\.library-page \.library-resume \.library-cover-image/);
 assert.match(css,/object-fit:contain/);
 assert.match(css,/object-position:center center/);
});
