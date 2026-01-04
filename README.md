# Lost & Found Portal - 50% Core Version

A simplified college campus lost and found portal with essential features for reporting and searching items.

## Features

- **Student Authentication**: Register and login system
- **Lost Items**: Report and view lost items
- **Found Items**: Report and view found items with search functionality
- **MySQL Database**: All data stored in MySQL database
- **Responsive Design**: Works on desktop and mobile

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp env.example .env
   ```
   Edit `.env` with your MySQL credentials.

3. **Initialize database:**
   ```bash
   npm run init-db
   ```

4. **Start the server:**
   ```bash
   npm run dev
   ```

5. **Access the portal:**
   Open `http://localhost:3000`

## Usage

1. Register a new student account
2. Login with your credentials
3. Report lost or found items
4. Search through found items using the search bar

## Database Tables

- `students` - User information
- `lost_items` - Lost item reports
- `found_items` - Found item reports
- `categories` - Item categories

## API Endpoints

- `POST /api/auth/register` - Register student
- `POST /api/auth/login` - Login student
- `GET /api/lost-items` - Get all lost items
- `POST /api/lost-items` - Report lost item
- `GET /api/found-items` - Get all found items
- `POST /api/found-items` - Report found item






