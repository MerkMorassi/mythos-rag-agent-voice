
# MythOS COMMS - Local Setup

This is a Vite-based React application for real-time voice conversations with Gemini, grounded in a local knowledge base.

## Prerequisites

- **Node.js and npm:** You must have Node.js (which includes npm) installed on your machine.

## 1. Setup

First, open your terminal in the project's root directory and install the necessary dependencies by running:

```bash
npm install
```

## 2. Environment Configuration

Next, create a file named `.env` in the root of the project. This file will hold your secret API keys. Add your Google Gemini API key to it like this:

```
# .env file
API_KEY="AIza..."
```

*The application is pre-configured to read this `API_KEY` variable automatically.*

## 3. Running the Application

To start the local development server on **port 4000**, run the following command in your terminal:

```bash
npm start
```

This command executes the `start` script defined in `package.json`, which launches the Vite server. Your default web browser should open automatically to `http://localhost:4000`.
