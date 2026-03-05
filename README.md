# KnowledgeBridge
A VS code extension that enhance program comprehension and facilitate knowledge transfer
# vscode_pcext


An extension of VS Code that aids in program comprehension. 

# Setup

1. Clone the repository to a local directory.
2. Run `npm install` in the cloned directory.

# OpenAI setup

## API Key

*To use the LLM tools you will need an OpenAI API key.*
- Take note of your OpenAI API key
- Create a file in the `src` directory called `openai-API-key.ts` and add the line
    - `export const apiKey = "[api key here]"`

## Embeddings

*This assumes that documentation files have been prepared in the local filesystem*
- Take note of the path of the local documentation directory
- Create a file in the `src` directory called `embeddings-location.ts` and add the line
    - `export const embeddingsLocation = "[documenation path here]"`

*There is currently no way to generate the embeddings dataset other than a hard-coded call to the `createEmbeddingsDataset` function in `openai-API`*

---

*These files should not be committed to the repository. They are already listed in the gitignore.*

# Opening the Project

In vscode, open the project directory with either
- **File > Open Folder**
- `Ctrl+K Ctrl+O`

# Running the Extension

- Press `F5` to open the extension in a new debugging window.
- In the debugging window, you can run the extension command on the selected symbol with
    - `F12`
    - the context menu
    - the command pallette (`Ctrl+Shift+P` - enter command name)

---


