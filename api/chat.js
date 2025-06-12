// File: /api/chat.js

import { kv } from '@vercel/kv';

// This is the magic line that enables Edge Functions and eliminates cold starts.
export const config = {
  runtime: 'edge',
};

// --- CONFIGURATION ---
const MESSAGE_LIMIT = 15; // Max messages per user
const TIME_WINDOW_SECONDS = 3600; // 1 hour in seconds

export default async function handler(request) {
  // STEP 1: Handle the CORS preflight request for browsers.
  // This must be handled before any other logic.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // A universal try...catch block to ensure any error returns a proper JSON response with CORS headers.
  try {
    // STEP 2: Ensure the request method is POST.
    if (request.method !== 'POST') {
      throw new Error('Method not allowed. Please use POST.');
    }

    // STEP 3: Rate Limiting Logic
    const ip = request.headers.get('x-forwarded-for');
    if (!ip) {
      throw new Error('Could not identify user.');
    }

    const key = `rate_limit_${ip}`;
    let record = await kv.get(key);

    if (!record || (Date.now() - record.firstRequestTime) / 1000 > TIME_WINDOW_SECONDS) {
      record = { count: 0, firstRequestTime: Date.now() };
    }

    if (record.count >= MESSAGE_LIMIT) {
      // Use a custom Error subclass for specific status codes
      throw new Error('Rate limit exceeded. The custom message will be handled on the client.');
    }
    
    // STEP 4: Get the user's message from the request body.
    let body;
    try {
      body = await request.json();
    } catch {
      throw new Error('Invalid request body. Please send a valid JSON.');
    }

    const { message } = body;
    if (!message || typeof message !== 'string') {
      throw new Error('A "message" property is required in the request body.');
    }

    // STEP 5: Call the Groq AI API.
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        model: 'llama3-8b-8192'
      })
    });

    if (!groqResponse.ok) {
        const errorDetails = await groqResponse.text();
        console.error("Groq API Error:", errorDetails);
        throw new Error('The AI service failed to respond.');
    }
    
    // STEP 6: Update the rate limit count in the database AFTER a successful AI call.
    await kv.set(key, { ...record, count: record.count + 1 }, { ex: TIME_WINDOW_SECONDS });

    const data = await groqResponse.json();
    const botMessage = data.choices[0]?.message?.content || "Sorry, I couldn't get a response.";

    // STEP 7: Send the successful response back to the client.
    return new Response(JSON.stringify({ reply: botMessage }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    // This is our universal error handler. It catches any error thrown above.
    console.error('An error occurred:', error);
    
    let errorMessage = error.message;
    let statusCode = 500; // Internal Server Error by default

    if (errorMessage.includes('Rate limit exceeded')) {
        errorMessage = "To make things work for everyone, limits are applied. I am sorry but this community tool is for everyone to benefit from it for a quick AI question and not your daily model.";
        statusCode = 429; // Too Many Requests
    } else if (errorMessage.includes('Method not allowed')) {
        statusCode = 405;
    }

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // CRITICAL: Also add CORS header to error responses
      },
    });
  }
}
