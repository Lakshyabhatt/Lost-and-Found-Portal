# 🎓 Lost and Found Portal

A **web-based Lost and Found Portal** built using **Node.js, Express, and MySQL**.  
This system enables users to report lost or found items and submit claims in an organized and efficient manner.

---

## 📌 Project Overview

The **Lost and Found Portal** provides a centralized digital platform where users can:

- 👤 Register and log in securely  
- 📄 Report **lost items**  
- 🔍 Report **found items**  
- 📨 Submit **claims** for items  
- 🔄 Manage item recovery digitally  

This project is developed as a **college-level web application**, focusing on **backend development**, **RESTful APIs**, and **database design**.

---

## 🚀 Features

- 👤 User Authentication (Register & Login)  
- 📄 Report Lost Items  
- 🔍 Report Found Items  
- 📨 Claim Lost / Found Items  
- 🗄️ MySQL Database Integration  
- 🔄 RESTful API Design  
- 📁 Clean & Modular Code Structure  

---

## 🛠️ Tech Stack

| Technology | Purpose |
|----------|--------|
| Node.js | Server-side runtime |
| Express.js | Backend framework |
| MySQL | Relational database |
| HTML | Frontend structure |
| JavaScript | Client-side logic |
| npm | Dependency management |

---

## 📂 Project Structure

Lost&Found/
│
├── server.js
├── package.json
│
├── config/
│ └── database.js
│
├── routes/
│ ├── auth.js
│ ├── simple-lostItems.js
│ ├── simple-foundItems.js
│ └── claims.js
│
├── scripts/
│ ├── init-database.js
│ └── create-tables.js
│
├── public/
│ ├── index.html
│ └── script.js
│
└── README.md

yaml
Copy code

---

## 🗄️ Database Design

The project uses the following main tables:

- **users** – Stores user details  
- **lost_items** – Stores lost item information  
- **found_items** – Stores found item information  
- **claims** – Stores item claim requests  

Database initialization scripts are available in the `scripts/` folder.

---

## ⚙️ Installation & Setup

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/your-username/lost-and-found-portal.git
cd lost-and-found-portal
2️⃣ Install Dependencies
bash
Copy code
npm install
3️⃣ Configure Database
Create a MySQL database

Update database credentials in config/database.js

4️⃣ Initialize Database
bash
Copy code
node scripts/init-database.js
node scripts/create-tables.js
5️⃣ Run the Server
bash
Copy code
node server.js
📍 Server runs at:

arduino
Copy code
http://localhost:3000
👥 Project Team
Lakshya – Backend Developer

Arpit Uniyal – Team Member

Anurag Singh – Team Member

Nupur Thapa – Team Member

📜 License
This project is licensed under the MIT License.
