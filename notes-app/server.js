const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const webpush    = require('web-push');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');

// ⚠️ Сгенерируйте: npx web-push generate-vapid-keys
const vapidKeys = {
  publicKey:  'BJffjuqkF59AezULQAjPO8VHa8oOKPYxygwwhMGmGI16sz0OxBqNw21Mo8atMfe1HIdFfomoRFHKNPcaABRi87U',
  privateKey: '_beDbaB8B9-BDq5Te4pwLzTY74kDVHhvLA3_Sv5RJ5A'
};

webpush.setVapidDetails(
  'mailto:your-email@example.com', // ⚠️ укажите свой email
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

let subscriptions = [];
const reminders = new Map();

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
  console.log('Клиент подключён:', socket.id);

  socket.on('newTask', (task) => {
    io.emit('taskAdded', task);
    const payload = JSON.stringify({ title: 'Новая задача', body: task.text });
    subscriptions.forEach(sub =>
      webpush.sendNotification(sub, payload).catch(err => console.error('Push error:', err))
    );
  });

  socket.on('newReminder', (reminder) => {
    const { id, text, reminderTime } = reminder;
    const delay = reminderTime - Date.now();
    if (delay <= 0) return;

    const timeoutId = setTimeout(() => {
      const payload = JSON.stringify({ title: '⏰ Напоминание', body: text, reminderId: id });
      subscriptions.forEach(sub =>
        webpush.sendNotification(sub, payload).catch(err => console.error('Push error:', err))
      );
      reminders.delete(id);
    }, delay);

    reminders.set(id, { timeoutId, text, reminderTime });
    console.log(`Напоминание "${text}" через ${Math.round(delay/1000)} сек.`);
  });

  socket.on('disconnect', () => console.log('Клиент отключён:', socket.id));
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!subscriptions.some(s => s.endpoint === sub.endpoint)) subscriptions.push(sub);
  res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
  subscriptions = subscriptions.filter(s => s.endpoint !== req.body.endpoint);
  res.status(200).json({ message: 'Подписка удалена' });
});

app.post('/snooze', (req, res) => {
  const reminderId = parseInt(req.query.reminderId, 10);
  if (!reminderId || !reminders.has(reminderId))
    return res.status(404).json({ error: 'Reminder not found' });

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newDelay = 5 * 60 * 1000;
  const newTimeoutId = setTimeout(() => {
    const payload = JSON.stringify({ title: '⏰ Отложенное напоминание', body: reminder.text, reminderId });
    subscriptions.forEach(sub =>
      webpush.sendNotification(sub, payload).catch(err => console.error('Push error:', err))
    );
    reminders.delete(reminderId);
  }, newDelay);

  reminders.set(reminderId, { timeoutId: newTimeoutId, text: reminder.text, reminderTime: Date.now() + newDelay });
  res.status(200).json({ message: 'Snoozed for 5 minutes' });
});

server.listen(3001, () => console.log('Сервер: http://localhost:3001'));