Lost And Found Portal

A web-based Lost and Found Portal built using Node.js, Express, and MySQL.
This system allows users to report lost or found items and submit claims in an organized and efficient manner.

📌 Project Overview

The Lost and Found Portal provides a centralized platform where:

Users can register and log in

Report lost items

Report found items

Submit claims for items

Manage item recovery digitally

This project is developed as a college-level web application, focusing on backend development and database design.

🚀 Features

👤 User Authentication (Register & Login)

📄 Report Lost Items

🔍 Report Found Items

📨 Claim Lost / Found Items

🗄️ MySQL Database Integration

🔄 RESTful API Design

📁 Clean & Modular Code Structure

🛠️ Tech Stack
Technology	Purpose
Node.js	Server-side runtime
Express.js	Backend framework
MySQL	Relational database
HTML	Frontend structure
JavaScript	Client-side logic
npm	Dependency management
📂 Project Structure
Lost&Found/
│
├── server.js
├── package.json
│
├── config/
│   └── database.js
│
├── routes/
│   ├── auth.js
│   ├── simple-lostItems.js
│   ├── simple-foundItems.js
│   └── claims.js
│
├── scripts/
│   ├── init-database.js
│   └── create-tables.js
│
├── public/
│   ├── index.html
│   └── script.js
│
└── README.md

🗄️ Database Design

Main tables used in the project:

users – Stores user details

lost_items – Stores lost item information

found_items – Stores found item information

claims – Stores item claim requests

Database initialization scripts are included in the scripts/ folder.

⚙️ Installation & Setup
1️⃣ Clone the Repository
git clone https://github.com/your-username/lost-and-found-portal.git
cd lost-and-found-portal

2️⃣ Install Dependencies
npm install

3️⃣ Configure Database

Create a MySQL database

Update credentials in config/database.js

4️⃣ Initialize Database
node scripts/init-database.js
node scripts/create-tables.js

5️⃣ Run the Server
node server.js


📍 Server runs at:

http://localhost:3000

🧪 Sample API Endpoints
Method	Endpoint	Description
POST	/auth/register	Register a new user
POST	/auth/login	User login
POST	/lost	Add lost item
POST	/found	Add found item
POST	/claims	Claim an item
🔒 Security Considerations

Password hashing (bcrypt) can be added

JWT-based authentication can be implemented

Environment variables (.env) recommended for credentials

🌱 Future Enhancements

🔐 JWT Authentication

🤖 AI-based matching of lost & found items

📧 Email notifications

🖼️ Image upload for items

👮 Admin dashboard

📱 Mobile app integration

🎓 Academic Use

This project is suitable for:

DBMS Mini Project

Web Technology Project

Backend Development Practice

👨‍💻 Author

Lakshya
Computer Science Engineering Student
