"""
Smart Legal Assistant - Local Runner
Extracted from WEB_DEMO (1).ipynb

Usage:
  cd to the Test/ directory, then run this script inside the venv.
"""

import gradio as gr
from transformers import pipeline
from pypdf import PdfReader

print("Loading models... (this may take a few minutes on first run while downloading)")

# Load models
summarizer = pipeline(
    "summarization",
    model="facebook/bart-large-cnn"
)

qa_model = pipeline(
    "question-answering",
    model="deepset/roberta-base-squad2"
)

print("Models loaded successfully!")

# --- HELPER FUNCTIONS ---

def extract_text(pdf_file):
    if pdf_file is None:
        return ""
    reader = PdfReader(pdf_file)
    text = ""
    for page in reader.pages:
        content = page.extract_text()
        if content:
            text += content + "\n"
    return text

def process_comprehensive_summary(text):
    if not text:
        return "No text to summarize."

    chunk_size = 3000
    chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]

    summaries = []
    for chunk in chunks[:3]:
        res = summarizer(chunk, max_length=150, min_length=40, do_sample=False)
        summaries.append(res[0]["summary_text"])

    return " ".join(summaries)

# --- MAIN AI FUNCTION ---

def legal_assistant_pro(pdf, text_input, question):
    context = extract_text(pdf) if pdf else text_input

    if not context or len(context.strip()) == 0:
        return "Please provide a document or text.", "N/A"

    full_summary = process_comprehensive_summary(context)

    answer = "No question asked."
    if question:
        result = qa_model(question=question, context=context[:4000])
        answer = result["answer"]

    return full_summary, answer

# --- GRADIO UI ---

with gr.Blocks(theme=gr.themes.Soft(), title="Smart Legal Assistant v2") as demo:
    gr.Markdown("""
    # ⚖️ Smart Legal Assistant Pro
    *Analyze long legal judgments, extract summaries, and query specific clauses instantly.*
    """)

    with gr.Row():
        with gr.Column(scale=1):
            with gr.Tabs():
                with gr.TabItem("📄 Upload PDF"):
                    file_input = gr.File(label="Legal Document")
                with gr.TabItem("✍️ Paste Text"):
                    text_box = gr.Textbox(lines=12, label="Legal Text", placeholder="Paste clauses here...")

            question_input = gr.Textbox(
                label="Ask a specific question",
                placeholder="e.g., What is the notice period?"
            )
            submit_btn = gr.Button("Analyze Document", variant="primary")

        with gr.Column(scale=1):
            summary_output = gr.Textbox(label="Comprehensive Summary", lines=10)
            answer_output = gr.Textbox(label="Direct Answer", lines=3)

    submit_btn.click(
        fn=legal_assistant_pro,
        inputs=[file_input, text_box, question_input],
        outputs=[summary_output, answer_output]
    )

print("Launching Gradio UI — open http://localhost:7860 in your browser")
demo.launch(share=False, server_name="0.0.0.0", server_port=7860)
