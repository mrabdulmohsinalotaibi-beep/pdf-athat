const $ = id => document.getElementById(id);
const gate = $('authGate'), app = $('app'), form = $('authForm');
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pdf-athat-auth') : null;
let mode = 'login', busy = false, challengeId = '', verifiedEmail = '', user = null, loaded = false, signupReady = false;
let checking = null;
const messages = {
 login: ['أهلًا بعودتك', 'سجّل الدخول إلى مساحتك بالإيميل وكلمة المرور.', 'تسجيل الدخول'],
 signup: ['أنشئ حسابك', 'سجّل بإيميلك، ثم أكّد ملكيته برمز يصلك في رسالة.', 'إنشاء الحساب'],
 verify: ['أكّد بريدك الإلكتروني', 'أدخل رمز التحقق المرسل إلى بريدك. تنتهي صلاحيته خلال 10 دقائق.', 'تأكيد الحساب'],
 forgot: ['استعادة كلمة المرور', 'أدخل إيميل حسابك لإرسال رمز الاستعادة.', 'إرسال رمز الاستعادة'],
 reset: ['كلمة مرور جديدة', 'أدخل رمز الاستعادة واختر كلمة مرور جديدة.', 'حفظ كلمة المرور']
};
async function api(action, data) {
 const response = await fetch('./api/auth/' + action, {
  method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
  headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000)
 });
 let result;
 try { result = await response.json(); } catch { throw Error('خدمة الحسابات غير متاحة الآن. حاول لاحقًا.'); }
 if (!response.ok) throw Error(result.error || 'تعذر إكمال الطلب. حاول لاحقًا.');
 return result;
}
function setMode(next, message = '') {
 mode = next;
 form.reset();
 const [title, intro, submit] = messages[mode];
 $('authTitle').textContent = title;
 $('authIntro').textContent = intro + (['verify','reset'].includes(mode) ? ` (${verifiedEmail})` : '');
 $('authSubmit').textContent = submit;
 $('authMessage').textContent = message;
 $('authTabs').hidden = !['login','signup'].includes(mode);
 $('authForgot').hidden = mode !== 'login';
 $('authBack').hidden = ['login','signup'].includes(mode);
 $('authBack').textContent = mode === 'verify' ? 'تغيير البريد أو طلب رمز جديد' : 'العودة لتسجيل الدخول';
 const hasEmail = ['login','signup','forgot'].includes(mode), hasCode = ['verify','reset'].includes(mode);
 const hasPassword = ['login','signup','reset'].includes(mode), hasConfirm = ['signup','reset'].includes(mode);
 for (const [name, visible] of [['Email',hasEmail],['Code',hasCode],['Password',hasPassword],['Confirm',hasConfirm]]) {
  $('auth' + name + 'Label').hidden = !visible;
  $('auth' + name).disabled = !visible;
  $('auth' + name).required = visible;
 }
 $('authPassword').minLength = hasConfirm ? 6 : 1;
 $('authPassword').autocomplete = hasConfirm ? 'new-password' : 'current-password';
 $('authPasswordHint').hidden = !hasConfirm;
 for (const button of document.querySelectorAll('[data-auth-mode]')) button.setAttribute('aria-pressed', String(button.dataset.authMode === mode));
 $('authSubmit').disabled = busy || (['signup','forgot'].includes(mode) && !signupReady);
}
function lock(message = '') {
 app.hidden = true;
 app.inert = true;
 gate.hidden = false;
 user = null;
 setMode('login', message);
}
async function unlock(nextUser) {
 if (loaded && user?.id !== nextUser.id) { location.reload(); return; }
 user = nextUser;
 window.__pdfAccountId = user.id;
 try {
  // The PDF module and local library initialize only after a server-validated session.
  if (!loaded) {
   await import(document.querySelector('script[data-app-module]').dataset.appModule);
   loaded = true;
   const identity = document.createElement('span');
   identity.className = 'auth-identity'; identity.textContent = user.email; identity.title = user.email;
   const logout = document.createElement('button');
   logout.type = 'button'; logout.textContent = 'تسجيل الخروج'; logout.className = 'auth-logout';
   logout.onclick = async () => {
    logout.disabled = true;
    try { await api('logout', {}); channel?.postMessage('changed'); location.reload(); }
    catch (error) { logout.disabled = false; alert(error.message); }
   };
   document.querySelector('.header-actions').prepend(identity, logout);
  }
  gate.hidden = true; app.hidden = false; app.inert = false;
 } catch { lock('تعذر تحميل القارئ. أعد تحميل الصفحة للمحاولة مجددًا.'); }
}
async function checkSession() {
 if (checking) return checking;
 checking = (async () => {
  try {
   const result = await api('session');
   if (result.user) await unlock(result.user);
   else lock(loaded ? 'انتهت الجلسة. سجّل الدخول مجددًا.' : '');
  } catch (error) {
   // A transient outage or exhausted D1 quota is NOT proof of logout.
   // Do not unmount a locally-open library or discard its verified account.
   if (loaded && user) {
    $('authService').hidden = false;
    $('authService').textContent = 'خدمة الحسابات غير متاحة مؤقتًا؛ يمكنك مواصلة القراءة في الملفات المحلية. ستُراجع الجلسة عند عودة الاتصال.';
   } else {
    lock('تعذر التحقق من الجلسة حاليًا. لا تُحذف ملفاتك المحلية؛ أعد المحاولة عند عودة خدمة الحسابات.');
   }
  }
  finally { checking = null; }
 })();
 return checking;
}
for (const button of document.querySelectorAll('[data-auth-mode]')) button.onclick = () => { if (!busy) setMode(button.dataset.authMode); };
$('authForgot').onclick = () => { if (!busy) setMode('forgot'); };
$('authBack').onclick = () => { if (!busy) setMode(mode === 'verify' ? 'signup' : 'login'); };
form.onsubmit = async event => {
 event.preventDefault();
 if (busy || !form.reportValidity()) return;
 const email = $('authEmail').value.trim(), password = $('authPassword').value;
 if (['signup','reset'].includes(mode) && password !== $('authConfirm').value) {
  $('authMessage').textContent = 'كلمتا المرور غير متطابقتين.'; $('authConfirm').focus(); return;
 }
 busy = true; $('authSubmit').disabled = true; $('authMessage').textContent = 'جارٍ إكمال الطلب…';
 try {
  if (mode === 'login') { const result = await api('login', { email, password }); channel?.postMessage('changed'); await unlock(result.user); }
  else if (mode === 'signup' || mode === 'forgot') {
   const result = await api(mode, mode === 'signup' ? { email, password } : { email });
   challengeId = result.challengeId; verifiedEmail = email;
   setMode(mode === 'signup' ? 'verify' : 'reset', result.message);
  } else if (mode === 'verify') {
   const result = await api('verify', { challengeId, code: $('authCode').value });
   channel?.postMessage('changed'); await unlock(result.user);
  } else {
   const result = await api('reset', { challengeId, code: $('authCode').value, password });
   channel?.postMessage('changed'); setMode('login', result.message);
  }
 } catch (error) { $('authMessage').textContent = error.message || 'تعذر الاتصال. حاول مجددًا.'; }
 finally {
  busy = false; $('authPassword').value = ''; $('authConfirm').value = '';
  $('authSubmit').disabled = ['signup','forgot'].includes(mode) && !signupReady;
 }
};
channel?.addEventListener('message', () => { void checkSession(); });
window.addEventListener('pageshow', event => { if (event.persisted) void checkSession(); });
let lastSessionCheck = 0;
const refreshSession = () => {
 if (!loaded || document.hidden || Date.now() - lastSessionCheck < 10 * 60 * 1000) return;
 lastSessionCheck = Date.now();
 void checkSession();
};
document.addEventListener('visibilitychange', refreshSession);
window.addEventListener('online', () => { if (loaded) { lastSessionCheck = 0; refreshSession(); } });
setInterval(refreshSession, 10 * 60 * 1000);
setMode('login');
$('authSubmit').disabled = true;
try {
 const config = await api('config'); signupReady = config.signupReady;
 if (!signupReady) { $('authService').hidden = false; $('authService').textContent = 'إنشاء الحساب واستعادة كلمة المرور سيتاحان بعد تفعيل خدمة البريد.'; }
} catch { $('authService').hidden = false; $('authService').textContent = 'تعذر الاتصال بخدمة الحسابات الآن. تحقق من اتصالك وأعد تحميل الصفحة.'; }
await checkSession();
$('authSubmit').disabled = false;
