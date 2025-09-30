# Real-Time Chat Application

A modern, real-time chat application built with Node.js, Express, and Socket.io featuring a beautiful UI and real-time messaging capabilities.

## Features

- **Real-time messaging** - Instant message delivery using WebSockets
- **User presence** - See who's online in real-time
- **Typing indicators** - Know when someone is typing
- **Modern UI** - Beautiful, responsive design with animations
- **User-friendly** - Simple login and intuitive chat interface
- **Mobile responsive** - Works great on all devices

## Getting Started

### Prerequisites
- Node.js (version 14 or higher)
- npm (comes with Node.js)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   
   For development with auto-restart:
   ```bash
   npm run dev
   ```

3. **Open your browser:**
   Navigate to `http://localhost:3000`

## How to Use

1. **Join the chat:**
   - Enter your username on the login screen
   - Click the arrow button or press Enter

2. **Start chatting:**
   - Type your message in the input field
   - Press Enter or click the send button
   - See real-time messages from other users

3. **Features:**
   - View online users in the sidebar
   - See typing indicators when others are typing
   - Your messages appear on the right (blue)
   - Other users' messages appear on the left (gray)

## File Structure

```
├── server.js              # Main server file with Socket.io logic
├── package.json           # Dependencies and scripts
├── public/
│   ├── index.html        # Main HTML file
│   ├── style.css         # Modern CSS styling
│   └── script.js         # Client-side JavaScript
└── CHAT_README.md        # This file
```

## Technical Details

- **Backend:** Node.js with Express.js
- **Real-time:** Socket.io for WebSocket communication
- **Frontend:** Vanilla JavaScript with modern CSS
- **Styling:** Custom CSS with gradients and animations
- **Icons:** Font Awesome icons
- **Fonts:** Inter font from Google Fonts

## Customization

You can easily customize the chat app by:

- **Changing colors:** Edit the CSS variables in `public/style.css`
- **Adding features:** Extend the Socket.io events in `server.js`
- **Modifying UI:** Update the HTML structure in `public/index.html`
- **Adding rooms:** Implement chat rooms functionality

## Deployment

The app is ready for deployment to platforms like:
- Heroku
- Railway
- Render
- DigitalOcean App Platform

Make sure to set the `PORT` environment variable for production.

## Troubleshooting

- **Port already in use:** Change the PORT in `server.js` or kill the process using that port
- **Dependencies issues:** Delete `node_modules` and run `npm install` again
- **Connection issues:** Check if the server is running and accessible

Enjoy your new chat application! 🚀
