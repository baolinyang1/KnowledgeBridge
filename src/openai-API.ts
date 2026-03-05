import OpenAI from "openai";
import { apiKey } from "./openai-API-key";
import { embeddingsLocation } from "./embeddings-location";
import { cosineSimilarity } from "./cosine-similarity";
import { snippetPanel } from "./extension";
import * as vscode from "vscode";

const openai = new OpenAI({ apiKey: apiKey });
let messages: any[] = [];
let newMessages: any[] = [];

export async function generateOutput(instruction: string, snippet: string, type: string, confSkip: boolean, index: number) {

	newMessages = [];

	switch (type) {
		case "label":
			instruction = "Generate a very brief label consisting of two or three words in camelCase for the following code snippet.\n";
			return await generateInfoOutput(instruction, snippet);
		case "description":
			instruction = "Generate a very brief description for the following code snippet.\n";
			return await generateInfoOutput(instruction, snippet);
		case "chat":
			intitializeMessageArray(index);
			if (snippet) {
				newMessages.push({ role: "user", content: "Consider the following snippet.\n" + snippet });
			}
			newMessages.push({ role: "user", content: instruction });
			return await generateChatMessage(newMessages);
		case "context":
			intitializeMessageArray(index);
			newMessages.push({ role: "user", content: instruction });
			return;
		case "fetch":
			intitializeMessageArray(index);
			const query = `Consider the following snippet.\n"""\n${snippet}\n"""\n${instruction}`;
			// newMessages.push({ role: "user", content: query });	// query is pushed to history along with documentation
			return await embeddingsAsk(query, confSkip);
	}
}

async function generateInfoOutput(instruction: string, snippet: string) {
	const prompt = instruction + snippet;
	return (await completionsOutput([{ role: "user", content: prompt }])).content;
}

function intitializeMessageArray(index: number) {
	if (!messages[index]) {
		messages[index] = [];
	}
	newMessages = messages[index];
}

async function generateChatMessage(messages: any[]) {
	const ouput = await completionsOutput(messages);
	newMessages.push(ouput);
	return ouput.content;
}

async function completionsOutput(messages: any[]): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
	const completion = await openai.chat.completions.create({
		messages: messages,
		model: "gpt-3.5-turbo"
	});
	return completion.choices[0].message;
}

export function getMessageHistory(): object[] {
	return messages;
}

export function setMessageHistory(restoredMessages: object[]): void {
	messages = restoredMessages;
}

export async function createEmbedding(textInput: string): Promise<number[]> {
	const embedding = await openai.embeddings.create({
		model: "text-embedding-3-small",
		input: textInput,
		encoding_format: "float"
	});
	return embedding.data[0].embedding;
}

export async function createEmbeddingsDataset(filepath: string): Promise<void> {
	const directory = vscode.Uri.file(filepath);
	const files = await vscode.workspace.fs.readDirectory(directory);
	let csvContent = "";
	for (const file of files) {
		if (file[1] !== 2) {
			const textContent = (await vscode.workspace.openTextDocument(vscode.Uri.joinPath(directory, file[0]))).getText().replaceAll("\"", "\"\"");
			const embedding = await createEmbedding(textContent);
			csvContent += [[textContent, embedding].map(i => "\"" + i + "\"")].join(",") + "\r\n";
		}
	}
	vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, "data/embeddings.csv"), new TextEncoder().encode(csvContent));
}

export async function loadEmbeddingsDataset(filepath: string): Promise<any[]> {
	const file: vscode.Uri = vscode.Uri.file(filepath);
	const textContent: string = (await vscode.workspace.openTextDocument(file)).getText();
	const splitText = textContent.match(/(?:[^,"'\r\n]|"[^"]*")+/g);
	const embeddingsDocuments: string[] = splitText!.filter(i => splitText!.indexOf(i) % 3 === 0).map(i => i.replace(/"(?!")/g, "").replace(/""/g, "\""));
	const embeddingsVectors: number[][] = splitText!.filter(i => splitText!.indexOf(i) % 3 === 1).map(i => i.replace(/"/g, "").split(",").map(Number));
	const embeddingsFilenames: string[] = splitText!.filter(i => splitText!.indexOf(i) % 3 === 2);
	const embeddings: any[] = [];
	for (const i in embeddingsVectors) {
		embeddings.push({
			document: embeddingsDocuments[i],
			embedding: embeddingsVectors[i],
			filename: embeddingsFilenames[i]
		});
	}
	return embeddings;
}

export async function rankByRelatedness(query: string, filepath: string, topN: number = 1): Promise<any[]> {
	const embeddings = (await loadEmbeddingsDataset(filepath));
	const relatednesScores = [];
	for (const embedding of embeddings) {
		relatednesScores.push({
			score: cosineSimilarity(await createEmbedding(query), embedding.embedding),
			document: embedding.document,
			filename: embedding.filename
		});
	}
	return relatednesScores.sort((a, b) => b.score - a.score).slice(0, topN);
}

export async function embeddingsAsk(query: string, confSkip: boolean, filepath: string = embeddingsLocation) {
	const relatedDocs = await rankByRelatedness(query, filepath, 3);
	let documentContent = relatedDocs[0].document;
	let documentName = relatedDocs[0].filename;

	if (!confSkip) {
		let documentAccept;
		for (const doc of relatedDocs) {
			documentContent = doc.document;
			documentName = doc.filename;
			documentAccept = await confirmDocument(documentName, documentContent);
			if (documentAccept === "OK") {
				break;
			}
		}
		if (!documentAccept) {
			return;
		}
	}

	const introduction = "Use the below documentation to answer the subsequent question.";
	const documentation = `Documentation:\n"""\n${documentContent}\n"""`;
	const question = `\n\nQuestion: ${query}`;
	const message = introduction + documentation + question;

	snippetPanel.webview.postMessage({ command: "postDocumentFound", content: documentName });
	newMessages.push({ role: "user", content: message });
	return await generateChatMessage(newMessages);
}

async function confirmDocument(name: string, content: string) {
	let documentAccept;
	do {
		documentAccept = await vscode.window.showInformationMessage(
			`Found related document "${name}"\nWould you like to proceed with this document as context input?`,
			{ modal: true },
			...["Preview","OK"]
		);
		if (!documentAccept) {
			return;
		} else if (documentAccept === "Preview") {
			await vscode.window.showInformationMessage(content, { modal: true });
		}
	} while (documentAccept === "Preview");
	return documentAccept;
}