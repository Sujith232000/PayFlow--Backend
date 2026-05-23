# PayFlow — Backend Banking Ledger Engine

A high-performance, secure, and ACID-compliant banking ledger backend designed to manage reliable monetary transfers, user authentication, and transaction compliance. Built with an integration-tested backend design to guarantee mathematical accuracy under concurrent transfer conditions.

 **Live API Endpoint:** [https://payflow-backend-1.onrender.com](https://payflow-backend-1.onrender.com)

---

##  Core Architecture & Tech Stack

- **Runtime Environment:** Node.js with Express.js (RESTful API Design)
- **Database Layer:** PostgreSQL hosted on Neon (Serverless Cloud Database)
- **Object-Relational Mapping (ORM):** Prisma
- **Data Validation Middleware:** Zod (Type-safe request payload enforcement)
- **Security & Session Management:** JSON Web Tokens (JWT) & bcrypt password hashing
- **Testing Framework:** Jest with Supertest for end-to-end integration mapping

---

##  Core Engineering Features

- **ACID-Compliant Transaction Ledger:** Leverages robust database constraints to execute atomic row-level locking during monetary transfers, completely mitigating race conditions and balance synchronization bugs.
- **Dynamic Overdraft Guard:** Built-in middleware structures that evaluate balance thresholds pre-transaction, applying automated overdraft fees safely without panicking the server thread.
- **Strict Schema Enforcement:** Integrated Zod validation layer to intercept and block malformed payloads (e.g., negative transfer values, invalid string formats) at the gate before invoking database operations.
- **Secure Authentication Perimeter:** Cryptographically signs and validates stateless user sessions via JWT headers, fully shielding historical ledger routes from unauthorized public traffic.

---

##  Production API Reference

### 🔐 Authentication Gateway
| Method | Endpoint | Description | Payload (JSON) |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/signup` | Registers a permanent cloud user account | `{"name": "...", "email": "...", "password": "..."}` |
| `POST` | `/api/v1/login` | Authenticating user credentials and returns custom JWT access token | `{"email": "...", "password": "..."}` |

###  User & Financial Ledger Services (Protected Routes)
*Requires `Authorization: Bearer <JWT_TOKEN>` header*

| Method | Endpoint | Description | Payload / Query Options |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/transfer` | Processes an atomic monetary transfer between accounts (*Rate-limited via middleware*) | **Body:** `{"receiverId": "UUID", "amount": 50}` |
| `GET` | `/api/v1/profile` | Fetches core account details and balance for the authenticated user | *None* |
| `GET` | `/api/v1/history` | Retrieves complete transaction history logs processed through the validation layer | **Query:** Validated against `historyQuerySchema` |

## Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Sujith232000/PayFlow--Backend.git](https://github.com/Sujith232000/PayFlow--Backend.git)
   cd PayFlow--Backend