// File: /api/chat.js

import { kv } from '@vercel/kv';

// --- CONFIGURATION ---
const MESSAGE_LIMIT = 15; // Max messages per user
const TIME_WINDOW_SECONDS = 60 * 60; // 1 hour window

export default async function handler(request, response) {
    // We only want to handle POST requests
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    // Get the user's IP address from the request.
    // Vercel provides this in the `x-forwarded-for` header.
    const ip = request.headers['x-forwarded-for'] || request.socket.remoteAddress;

    if (!ip) {
        return response.status(400).json({ error: 'Could not identify user IP address.' });
    }

    // Create a unique key for this IP address in the KV store
    const key = `rate_limit_${ip}`;

    try {
        // --- RATE LIMITING LOGIC ---
        let record = await kv.get(key);

        if (!record) {
            // If no record exists, create a new one.
            record = { count: 0, firstRequestTime: Date.now() };
        }

        // Check if the time window has expired
        const isExpired = (Date.now() - record.firstRequestTime) / 1000 > TIME_WINDOW_SECONDS;
        if (isExpired) {
            // If expired, reset the record
            record = { count: 0, firstRequestTime: Date.now() };
        }

        if (record.count >= MESSAGE_LIMIT) {
            // If limit is reached, send the custom error message
            const errorMessage = "To make things work for everyone, limits are applied. I am sorry but this community tool is for everyone to benefit from it for a quick AI question and not your daily model.";
            return response.status(429).json({ error: errorMessage }); // 429 is the "Too Many Requests" status code
        }
        
        // --- END OF RATE LIMITING LOGIC ---


        // If the user is within limits, proceed with the AI call
        const { message } = request.body;
        if (!message) {
            return response.status(400).json({ error: 'Message is required' });
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

        // Increment the user's message count in the database
        await kv.set(key, { ...record, count: record.count + 1 });

        const data = await groqResponse.json();
        const botMessage = data.choices[0]?.message?.content || "Sorry, I couldn't get a response.";

        return response.status(200).json({ reply: botMessage });

    } catch (error) {
        console.error('API Error:', error);
        return response.status(500).json({ error: error.message || 'Failed to communicate with the AI service.' });
    }
}
