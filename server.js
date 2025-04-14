require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const app = express();
const port = 5000;


// MySQL database connection
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

// API key for validation (Store this securely in your environment variables)
const API_KEY = process.env.SECRETE_KEY; // Replace with your actual API key
console.log('API_KEY----', API_KEY)
const secureURL = process.env.SECURE_URL;

// Middleware to check API key
function checkApiKey(req, res, next) {
  const apiKey = req.header('x-api-key'); // API key in the header

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid or missing API Key' });
  }

  next();
}

// Middleware
app.use(cors({
    origin: secureURL,  // Only allow requests from this URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'],  // You can specify the methods you want to allow
    credentials: true  // If you're using cookies, enable this to allow credentials
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply API key check to all API routes
app.use('/api', checkApiKey);

// Ensure 'uploads' directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Store uploaded files in 'uploads/' directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Make uploaded files publicly accessible
app.use('/uploads', express.static('uploads'));

// POST new todo
app.post('/api/todos', upload.single('attachment'), (req, res) => {
  const { task, dueDate, completed } = req.body;

  const attachment = req.file ? req.file.filename : null; // saved filename on disk
  const completedStatus = completed === 'true' ? 1 : 0;
  const created_at = new Date();
  const updated_at = new Date();

  const query = `
    INSERT INTO todos (task, due_date, completed, attachment, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [task, dueDate || null, completedStatus, attachment, created_at, updated_at],
    (err, result) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).json({ error: 'Error creating todo' });
      }

      res.status(201).json({
        id: result.insertId,
        task,
        dueDate: dueDate || null,
        completed: completedStatus === 1,
        attachmentUrl: attachment ? `/uploads/${attachment}` : null,
        created_at: created_at.toISOString(),
        updated_at: updated_at.toISOString()
      });
    }
  );
});

// GET todos
app.get('/api/todos', (req, res) => {
  db.query('SELECT id, task, completed, due_date as dueDate, attachment, created_at, updated_at FROM todos ORDER BY 1 DESC', (err, results) => {
    if (err) return res.status(500).json({ error: 'Error fetching todos' });

    // Attach full file URL
    const todosWithUrls = results.map(todo => ({
      ...todo,
      attachmentUrl: todo.attachment ? `/uploads/${todo.attachment}` : null
    }));

    res.json(todosWithUrls);
  });
});

// PUT update todo
app.put('/api/todos/:id', upload.single('attachment'), (req, res) => {
  const todoId = req.params.id;
  const { task, dueDate, completed } = req.body;
  const completedStatus = completed === 'true' ? 1 : 0;
  const updated_at = new Date();

  let query = `
    UPDATE todos 
    SET task = ?, due_date = ?, completed = ?, updated_at = ?
  `;
  const values = [task, dueDate || null, completedStatus, updated_at];

  // Handle new attachment if uploaded
  if (req.file) {
    query += `, attachment = ?`;
    values.push(req.file.filename);
  }

  query += ` WHERE id = ?`;
  values.push(todoId);

  db.query(query, values, (err, result) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ error: 'Error updating todo' });
    }

    res.json({ message: 'Todo updated successfully' });
  });
});

// DELETE todo
app.delete('/api/todos/:id', (req, res) => {
  const todoId = req.params.id;

  // Get the attachment name first
  db.query('SELECT attachment FROM todos WHERE id = ?', [todoId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Error finding todo' });

    if (results.length === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const attachment = results[0].attachment;

    // Delete the todo from the DB
    db.query('DELETE FROM todos WHERE id = ?', [todoId], (err) => {
      if (err) return res.status(500).json({ error: 'Error deleting todo' });

      // Also delete the file from disk
      if (attachment) {
        const filePath = path.join(__dirname, 'uploads', attachment);
        fs.unlink(filePath, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error('Error deleting file:', err);
          }
        });
      }

      res.json({ message: 'Todo deleted successfully' });
    });
  });
});

// DELETE all todos
app.delete('/api/todos', (req, res) => {
  // First, get all the attachment filenames before deleting the records
  db.query('SELECT attachment FROM todos', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching todos for deletion' });
    }

    // Get all filenames to delete them from disk
    const attachments = results.map(todo => todo.attachment).filter(Boolean); // Filter out null values

    // Delete all todos from the database
    db.query('DELETE FROM todos', (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error deleting todos' });
      }

      // Delete all the files associated with the todos
      attachments.forEach((filename) => {
        const filePath = path.join(__dirname, 'uploads', filename);
        fs.unlink(filePath, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error('Error deleting file:', err);
          }
        });
      });

      res.json({ message: 'All todos and associated files deleted successfully' });
    });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
