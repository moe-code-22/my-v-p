// File: /api/chat.js

import { kv } from '@vercel/kv';

// --- CONFIGURATION ---
const MESSAGE_LIMIT = 15; // Max messages per user
const TIME_WINDOW_SECONDS = 60 * 60; // 1 hour window

// --- CORS Headers ---
// These headers allow your frontend to communicate with this endpoint
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Allows any origin. For production, you could restrict this to your github.io domain.
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(request, response) {
  // The browser will send an 'OPTIONS' request first to check if it's safe to send the actual POST request.
  // We must respond to this with the correct CORS headers.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // We only want to handle POST requests for the actual chat logic
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get the user's IP address.
  const ip = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
  if (!ip) {
    return new Response(JSON.stringify({ error: 'Could not identify user IP address.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = `rate_limit_${ip}`;

  try {
    // --- RATE LIMITING LOGIC ---
    let record = await kv.get(key);
    if (!record || (Date.now() - record.firstRequestTime) / 1000 > TIME_WINDOW_SECONDS) {
      record = { count: 0, firstRequestTime: Date.now() };
    }

    if (record.count >= MESSAGE_LIMIT) {
      const errorMessage = "To make things work for everyone, limits are applied. I am sorry but this community tool is for everyone to benefit from it for a quick AI question and not your daily model.";
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // --- AI CALL LOGIC ---
    const { message } = await request.json(); // Moved this line here
    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
        throw new Error("The AI service returned an error.");
    }
    
    // Increment the user's message count in the database AFTER a successful AI call
    await kv.set(key, { ...record, count: record.count + 1 }, { ex: TIME_WINDOW_SECONDS });

    const data = await groqResponse.json();
    const botMessage = data.choices[0]?.message?.content || "Sorry, I couldn't get a response.";

    // Send the successful response
    return new Response(JSON.stringify({ reply: botMessage }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    // Send an error response
    return new Response(JSON.stringify({ error: error.message || 'Failed to communicate with the AI service.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
