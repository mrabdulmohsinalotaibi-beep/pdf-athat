import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encrypt} from '../workers/prayer-push-worker.mjs';

const base64url=bytes=>Buffer.from(bytes).toString('base64url');
const enc=new TextEncoder();
const combine=(...parts)=>{const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length}return result};
const derive=async(key,salt,info,length)=>{
 const imported=await crypto.subtle.importKey('raw',key,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},imported,length*8));
};

test('RFC8291 encrypted payload decrypts with receiver device key',async()=>{
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const receiverPub=new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey));
 const auth=crypto.getRandomValues(new Uint8Array(16));
 const payload={title:'PDF.ATHAT',body:'حان وقت صلاة الفجر'};
 const encrypted=await encrypt({p256dh:base64url(receiverPub),auth:base64url(auth)},payload);
 assert.equal(encrypted.length>110,true);
 const salt=encrypted.slice(0,16),recordSize=new DataView(encrypted.buffer,encrypted.byteOffset+16,4).getUint32(0);
 assert.equal(recordSize,4096);
 const keyLength=encrypted[20],serverPub=encrypted.slice(21,21+keyLength),cipher=encrypted.slice(21+keyLength);
 const sender=await crypto.subtle.importKey('raw',serverPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:sender},receiver.privateKey,256));
 const secret=await derive(shared,auth,combine(enc.encode('WebPush: info\0'),receiverPub,serverPub),32);
 const cek=await derive(secret,salt,enc.encode('Content-Encoding: aes128gcm\0'),16);
 const nonce=await derive(secret,salt,enc.encode('Content-Encoding: nonce\0'),12);
 const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['decrypt']);
 const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,cipher));
 assert.equal(plain.at(-1),2);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(plain.slice(0,-1))),payload);
});
