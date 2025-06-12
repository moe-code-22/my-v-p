// File: /api/chat.js
export default async function handler(request, response) {
  // Set CORS headers to allow requests from your GitHub Pages site
  response.setHeader('Access-Control-Allow-Origin', '*'); // For development, '*' is fine. For production, you might want to restrict this to your github.io domain.
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle the browser's preflight "OPTIONS" request
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // We only want to handle POST requests
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message } = request.body;
  if (!message) {
    return response.status(400).json({ error: 'Message is required' });
  }

  try {
    // Make the call to the Groq API
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        // Use the secret key stored in Vercel's environment variables
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        model: 'llama3-8b-8192'
      })
    });

    if (!groqResponse.ok) {
        const errorText = await groqResponse.text();
        console.error("Groq API Error:", errorText);
        throw new Error("The AI service returned an error.");
    }

    const data = await groqResponse.json();
    const botMessage = data.choices[0]?.message?.content || "Sorry, I couldn't get a response.";

    // Send the AI's response back to your chatbot frontend
    return response.status(200).json({ reply: botMessage });

  } catch (error) {
    console.error('Internal Server Error:', error);
    return response.status(500).json({ error: 'Failed to communicate with the AI service.' });
  }
}