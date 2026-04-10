// ===== App Shell: навигация =====
const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');

function setActiveButton(activeId) {
  [homeBtn, aboutBtn].forEach(btn => btn.classList.remove('active'));
  document.getElementById(activeId).classList.add('active');
}

async function loadContent(page) {
  try {
    const response = await fetch(`/content/${page}.html`);
    const html = await response.text();
    contentDiv.innerHTML = html;
    if (page === 'home') initNotes();
  } catch (err) {
    contentDiv.innerHTML = `<p class="is-center text-error">Ошибка загрузки страницы.</p>`;
    console.error(err);
  }
}

homeBtn.addEventListener('click', () => { setActiveButton('home-btn'); loadContent('home'); });
aboutBtn.addEventListener('click', () => { setActiveButton('about-btn'); loadContent('about'); });
loadContent('home');

// ===== WebSocket (практика 16) =====
let socket = null;
try {
  socket = io('http://localhost:3001');
  socket.on('connect', () => console.log('WebSocket подключён:', socket.id));
  socket.on('taskAdded', (task) => {
    const toast = document.createElement('div');
    toast.textContent = `Новая задача: ${task.text}`;
    toast.style.cssText = `position:fixed;top:10px;right:10px;background:#4285f4;
      color:white;padding:1rem;border-radius:5px;z-index:1000;`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  });
  socket.on('connect_error', () => console.warn('WebSocket недоступен'));
} catch(e) { console.warn('Socket.IO не загружен'); }

// ===== Удаление заметки (глобальная функция) =====
window.deleteNote = function(id) {
  const notes = JSON.parse(localStorage.getItem('notes') || '[]');
  const filtered = notes.filter(n => n.id !== id);
  localStorage.setItem('notes', JSON.stringify(filtered));
  // перерисовываем список
  const list = document.getElementById('notes-list');
  if (list) renderNotes(list, filtered);
}

function renderNotes(list, notes) {
  list.innerHTML = notes.map(note => {
    let reminderInfo = '';
    if (note.reminder) {
      const date = new Date(note.reminder);
      reminderInfo = `<br><small style="color:#888;">⏰ Напоминание: ${date.toLocaleString()}</small>`;
    }
    return `<li class="card" style="margin-bottom:0.5rem;padding:0.5rem;display:flex;justify-content:space-between;align-items:center;">
      <span>${note.text}${reminderInfo}</span>
      <button onclick="window.deleteNote(${note.id})" class="button error" style="padding:0.2rem 0.6rem;">✕</button>
    </li>`;
  }).join('');
}

// ===== Заметки + напоминания (практика 17) =====
function initNotes() {
  const form = document.getElementById('note-form');
  const input = document.getElementById('note-input');
  const reminderForm = document.getElementById('reminder-form');
  const reminderText = document.getElementById('reminder-text');
  const reminderTime = document.getElementById('reminder-time');
  const list = document.getElementById('notes-list');

  function loadNotes() {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    renderNotes(list, notes);
  }

  function addNote(text, reminderTimestamp = null) {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    const newNote = { id: Date.now(), text, reminder: reminderTimestamp };
    notes.push(newNote);
    localStorage.setItem('notes', JSON.stringify(notes));
    loadNotes();

    if (socket && socket.connected) {
      if (reminderTimestamp) {
        socket.emit('newReminder', { id: newNote.id, text, reminderTime: reminderTimestamp });
      } else {
        socket.emit('newTask', { text, timestamp: Date.now() });
      }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) { addNote(text); input.value = ''; }
  });

  if (reminderForm) {
    reminderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = reminderText.value.trim();
      const datetime = reminderTime.value;
      if (text && datetime) {
        const timestamp = new Date(datetime).getTime();
        if (timestamp > Date.now()) {
          addNote(text, timestamp);
          reminderText.value = '';
          reminderTime.value = '';
        } else {
          alert('Дата напоминания должна быть в будущем');
        }
      }
    });
  }

  loadNotes();
}

// ===== Push-уведомления (практика 16-17) =====
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

const VAPID_PUBLIC_KEY = 'BJffjuqkF59AezULQAjPO8VHa8oOKPYxygwwhMGmGI16sz0OxBqNw21Mo8atMfe1HIdFfomoRFHKNPcaABRi87U';

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    await fetch('http://localhost:3001/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    console.log('Push подписка отправлена');
  } catch (err) { console.error('Ошибка подписки:', err); }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await fetch('http://localhost:3001/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    await subscription.unsubscribe();
    console.log('Отписка выполнена');
  }
}

// ===== Service Worker + кнопки Push =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', reg.scope);

      const enableBtn = document.getElementById('enable-push');
      const disableBtn = document.getElementById('disable-push');

      if (enableBtn && disableBtn) {
        const subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          enableBtn.style.display = 'none';
          disableBtn.style.display = 'inline-block';
        }
        enableBtn.addEventListener('click', async () => {
          if (Notification.permission === 'denied') {
            alert('Уведомления запрещены в настройках браузера.'); return;
          }
          if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') { alert('Необходимо разрешить уведомления.'); return; }
          }
          await subscribeToPush();
          enableBtn.style.display = 'none';
          disableBtn.style.display = 'inline-block';
        });
        disableBtn.addEventListener('click', async () => {
          await unsubscribeFromPush();
          disableBtn.style.display = 'none';
          enableBtn.style.display = 'inline-block';
        });
      }
    } catch (err) { console.log('SW registration failed:', err); }
  });
}