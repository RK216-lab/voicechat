export const config = { runtime: 'edge' };

export default async function handler(req) {
  // POST以外は拒否
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }

  try {
    // -----------------------------
    // リクエストボディ
    // -----------------------------
    const body = await req.json();

    // -----------------------------
    // APIキー
    // Vercelの環境変数から取得
    // -----------------------------
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'GROQ_API_KEY is not configured'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // messagesがない場合
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'messages is required'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // -----------------------------
    // Groq API
    // -----------------------------
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          // Llama 3.1 8Bから移行
          model: 'openai/gpt-oss-20b',

          // フロントから渡されたmessagesをそのまま使用
          // ターンごとのsystem prompt変更にも対応
          messages: body.messages,

          // ボイチャなので極端に長い回答を防ぐ
          temperature: 0.7,

          // 音声会話用なので短め
          max_completion_tokens: 100
        })
      }
    );

    // -----------------------------
    // Groqレスポンス
    // -----------------------------
    const data = await response.json();

    // APIエラー
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error:
            data?.error?.message ||
            'Groq API request failed'
        }),
        {
          status: response.status,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // -----------------------------
    // テキスト取得
    // -----------------------------
    const text =
      data?.choices?.[0]?.message?.content || '';

    // -----------------------------
    // フロントへ返す
    // -----------------------------
    return new Response(
      JSON.stringify({
        text
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );

  } catch (error) {
    // -----------------------------
    // 予期しないエラー
    // -----------------------------
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : String(error)
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }
}