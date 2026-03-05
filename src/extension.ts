import * as vscode from 'vscode';
import * as lead from './leadUtils';
import * as openai from './openai-API';
import { embeddingsLocation } from './embeddings-location';
import * as path from "path";
import * as gitUtils from './gitUtils';
import { DecorationManager, PinnedSnippet } from './decorationManager';

export let snippetPanel: vscode.WebviewPanel;
export let decorationManager: DecorationManager;
export let historyPanel: vscode.WebviewPanel;

// Auto-save file name in project root
const AUTO_SAVE_FILE_NAME = '.vscode-snippets-personal.json';

// Helper function to get project root path
function getProjectRootPath(): string {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		throw new Error('No workspace folder found');
	}
	return workspaceFolders[0].uri.fsPath;
}

// Helper function for auto-export
async function autoExportSnippets(): Promise<void> {
	try {
		if (!snippetPanel) {
			return; // No snippet panel available
		}

		const projectRoot = getProjectRootPath();
		const exportPath = path.join(projectRoot, AUTO_SAVE_FILE_NAME);
		
		// Send message to webview to trigger export
		snippetPanel.webview.postMessage({ 
			command: "autoExport", 
			filePath: exportPath 
		});
		
		//console.log(`Triggered auto-export to ${exportPath}`);
	} catch (error) {
		//console.error('Error during auto-export:', error);
	}
}

// Helper function for auto-import
async function autoImportSnippets(): Promise<void> {
	try {
		const projectRoot = getProjectRootPath();
		const importPath = path.join(projectRoot, AUTO_SAVE_FILE_NAME);
		const importUri = vscode.Uri.file(importPath);
		
		// Check if file exists
		try {
			await vscode.workspace.fs.stat(importUri);
		} catch {
			// File doesn't exist, nothing to import
			return;
		}
		
		// Read the file and send data to webview to trigger import
		const fileData = await vscode.workspace.fs.readFile(importUri);
		const jsonData = Buffer.from(fileData).toString('utf8');
		
		snippetPanel.webview.postMessage({ 
			command: "autoImport", 
			data: jsonData 
		});
		
		//console.log(`Triggered auto-import from ${importPath}`);
	} catch (error) {
		//console.error('Error during auto-import:', error);
	}
}

// Called at initial activation
export async function activate(context: vscode.ExtensionContext) {

	// Run at activation

	let leadsPanel: vscode.WebviewPanel = webviewSetup("Leads", 2, context.extensionUri, "src/leads.html");
	let filterPanel: vscode.WebviewPanel = webviewSetup("Filter", 2, context.extensionUri, "src/filter.html");
	snippetPanel = webviewSetup("Snippets", 2, context.extensionUri, "src/snippet.html");
	historyPanel = webviewSetup("Personal History", 2, context.extensionUri, "src/history.html");
	
	// Initialize decoration manager
	decorationManager = new DecorationManager(context);
	await decorationManager.initialize();

	// Auto-import snippets from previous session
	await autoImportSnippets();

	// Update history panel after decoration manager has loaded its persisted snippets
	updateHistoryPanel();
	console.log('Updated history panel with persisted snippets from global state');

	// Set up periodic auto-save (every 30 seconds)
	const autoSaveInterval = setInterval(() => {
		autoExportSnippets().catch(error => {
			console.error('Error during periodic auto-save:', error);
		});
	}, 10000); // 10 seconds

	// Save on window state changes (when VS Code loses focus)
	const windowStateDisposable = vscode.window.onDidChangeWindowState(windowState => {
		if (!windowState.focused) {
			autoExportSnippets().catch(error => {
				console.error('Error during focus-lost auto-save:', error);
			});
		}
	});

	// Save when workspace is about to close
	const workspaceDisposable = vscode.workspace.onWillSaveTextDocument(() => {
		autoExportSnippets().catch(error => {
			console.error('Error during workspace save auto-save:', error);
		});
	});

	// Clean up intervals and listeners on deactivation
	context.subscriptions.push(
		{ dispose: () => clearInterval(autoSaveInterval) },
		windowStateDisposable,
		workspaceDisposable
	);

	// Function to update history panel with current snippets
	function updateHistoryPanel(): void {
		if (!historyPanel) return;
		
		const snippets = decorationManager.getAllSnippets();
		console.log(`Updating history panel with ${snippets.length} snippets`);
		
		const snippetData = snippets.map(snippet => {
			console.log(`Processing snippet: ${snippet.label} (ID: ${snippet.id})`);
			return {
				id: snippet.id,
				label: snippet.label,
				description: snippet.description,
				fileName: snippet.fileName,
				lineNumbers: snippet.range.start.line === snippet.range.end.line 
					? `${snippet.range.start.line + 1}` 
					: `${snippet.range.start.line + 1}-${snippet.range.end.line + 1}`,
				code: '', // Will be filled when needed
				gitCommitInfo: snippet.gitCommitInfo,
				timestamp: snippet.timestamp,
				notes: snippet.notes || '',
				messages: snippet.messages || []
			};
		});

		// Get code content for each snippet
		Promise.all(snippetData.map(async (data, index) => {
			try {
				const snippet = snippets[index];
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(snippet.fileName));
				data.code = document.getText(snippet.range);
			} catch (error) {
				console.error(`Error reading snippet code for ${data.label}:`, error);
				data.code = 'Error loading code content';
			}
		})).then(() => {
			console.log('Sending snippet data to history panel:', snippetData.map(s => `${s.label} (${s.id})`));
			historyPanel.webview.postMessage({
				command: "updateHistory",
				snippets: snippetData
			});
		});
	}

	function openSnippetInAnalysisPanel(snippet: PinnedSnippet): void {
		vscode.workspace.openTextDocument(vscode.Uri.file(snippet.fileName)).then(document => {
			const code = document.getText(snippet.range);
			const startLineNum = snippet.range.start.line + 1;
			const endLineNum = snippet.range.end.line + 1;
			const lineNumbers = startLineNum === endLineNum ? `${startLineNum}` : `${startLineNum}-${endLineNum}`;

			snippetPanel.webview.postMessage({
				snippet: code,
				snippetLabel: snippet.label,
				lineNumbers: lineNumbers,
				fileName: snippet.fileName,
				gitCommitInfo: snippet.gitCommitInfo,
				messages: snippet.messages || [],
				command: "addSnippet"
			});
		});
	}
	
	positionWebviewTabs();

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('hello.helloWorld', () => {

		// Run at every execution
		return;
		
		// User has requested definition
		// Execute secondary command (notification) in conjunction with definition call
		// vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
		vscode.window.showInformationMessage('hello world');
		vscode.commands.executeCommand("editor.action.revealDefinition");

		// Output information about definition
		getDefinition().then(async result => {

			const definitionData: vscode.LocationLink = result[0] as vscode.LocationLink;
			await new Promise(resolve => setTimeout(resolve, 100));
			const document: vscode.TextDocument = vscode.window.activeTextEditor!.document;
			const functionNameRange: vscode.Range = definitionData.targetSelectionRange!;
			const functionDefinitionRange: vscode.Range = definitionData.targetRange;
			const functionDefinition: string = document.getText(functionDefinitionRange);

			// matching with LocationLink
			const functionFilePath: string = definitionData.targetUri.path;
			const functionLineNumber: number = functionNameRange.start.line;
			const functionPrototypeLine: string = document.lineAt(functionLineNumber).text.trim();
			const functionName: string = document.getText(functionNameRange);
			// matching by regex
			const params: RegExpMatchArray = functionPrototypeLine.match(/(?<=\().*(?=\))/)!;
			const returnType: RegExpMatchArray = functionPrototypeLine.match(/(?<=\): ).*(?=;)/)!;
			const body: RegExpMatchArray = functionDefinition.match(/(?<={).*(?=})/s)!;
			// const comment: RegExpMatchArray = document.getText().match(/\/\*\*.\*\//s);

			const printInfo: Array<any> = [
				functionPrototypeLine,
				functionFilePath,
				functionLineNumber,
				functionName,
				params,
				returnType,
				body,
				// comment
			];

			// output info about target function
			console.log(printInfo.join('\n'));
		});

	});
	context.subscriptions.push(disposable);

	// location storage table
	let locationTable = new Array();
	let hiddenLeads = new Array();
	let snippetTable = new Array();

	async function addLeads(uri?: vscode.Uri, pos?: vscode.Position, symbol?: string): Promise<any> {
		if (!symbol) symbol = getSymbol();
		const symbolID: number = generateID();
		
		let newLocationData: Array<any> = [];
		let symbolData = { leads: new Array(), symbol: symbol, command: "addLead", symbolID: symbolID };

		async function addLeadType(leads: lead.leadLocation[], leadType: string) {
			for (const i of leads) {
				const locationData = lead.getLocationData(i);
				const leadData = await getLeadData(locationData.uri, locationData.range, leadType);
				symbolData.leads.push(leadData);
				addLocationEntry(newLocationData, locationData.uri, locationData.range, leadData, symbol!, symbolID);
			}
		}

		await addLeadType(await getDefinition(uri, pos), "definition");
		const definitionData = symbolData.leads[0];
		if (locationTable.concat(hiddenLeads).filter(a => a.key.type === "definition").map(a => a.key.line).includes(definitionData.line)) return;
		await addLeadType(await getReferences(uri, pos), "reference");
		if (definitionData.line.match(new RegExp(`.*function.*${symbol}.*`))) {
			await addLeadType(await getIncomingCalls(uri, pos) as vscode.CallHierarchyIncomingCall[], "incoming call");
			await addLeadType(await getOutgoingCalls(uri, pos) as vscode.CallHierarchyOutgoingCall[], "outgoing call");
		}

		locationTable = locationTable.concat(newLocationData);

		// send data to webview
		leadsPanel.webview.postMessage(symbolData);
		filterPanel.webview.postMessage({ symbol: symbol, command: "addSymbol", symbolID: symbolID });
		// TODO: need to get class

		return symbolID;
	}

	function generateID(): number {
		const min: number = 10000;
		const max: number = 99999;
		let newID: number;
		do {
			newID = Math.floor(Math.random() * (max - min + 1) + min);
		} while (locationTable.map(i => i.symbolID).includes(newID));
		return newID;
	}

	// add to code exploration map
	disposable = vscode.commands.registerCommand("codeMap", async () => addLeads());
	context.subscriptions.push(disposable);

	async function pinSnippet(postSnippet: boolean, document?: vscode.TextDocument, selection?: vscode.Range, snippetLabel?: string, fileName?: string) {
		if (!document) {document = vscode.window.activeTextEditor!.document;}
		if (!selection) {selection = vscode.window.activeTextEditor!.selection;}
		const selectionStart: vscode.Position = document.lineAt(selection.start).range.start;
		const selectionEnd: vscode.Position = document.lineAt(selection.end).range.end;
		if (!fileName) {fileName = document.uri.path.replace(vscode.workspace.workspaceFolders![0].uri.path, "");}

		if (!snippetLabel) {
			// Generate label using format: snippet-filename-linenumber
			const fileBaseName = path.basename(fileName, path.extname(fileName)); // Remove path and extension
			const startLineNumber = selectionStart.line + 1;
			const endLineNumber = selectionEnd.line + 1;
			const lineRange = startLineNumber === endLineNumber ? `${startLineNumber}` : `${startLineNumber}-${endLineNumber}`;
			snippetLabel = `snippet-${fileBaseName}-${lineRange}`;
		}

		// Use new decoration manager for lightweight pinning
		const snippetId = await decorationManager.addSnippet(
			document,
			new vscode.Range(selectionStart, selectionEnd),
			snippetLabel
		);

		// Show notification
		vscode.window.showInformationMessage(
			`📌 Pinned "${snippetLabel}" - Click to jump back`,
			'Go to Snippet'
		).then(selection => {
			if (selection === 'Go to Snippet') {
				goToSnippet(snippetId);
			}
		});

		// Update history panel with new snippet in decoration manager
		updateHistoryPanel();

		// Legacy: still process symbol leads if needed
		const snippetEntry = { snippetLabel: snippetLabel, snippetSymbols: new Array() };
		
		// Get git commit information for the selected code
		let gitCommitInfo: gitUtils.GitCommitInfo | null = null;
		try {
			const isGitRepo = await gitUtils.isGitRepository();
			if (isGitRepo) {
				gitCommitInfo = await gitUtils.getGitCommitInfo(
					document.uri.fsPath,
					selectionStart.line + 1,
					selectionEnd.line + 1
				);
			}
		} catch (error) {
			console.error('Error getting git commit info:', error);
		}
		
		// *Note* The range processing algorithm below may be inefficient - to revise
		// get symbol ranges from selection range
		let posStepper = selectionStart;
		let symbolRange: vscode.Range | undefined;
		while (posStepper.isBefore(selectionEnd)) {
			symbolRange = document.getWordRangeAtPosition(posStepper);
			while (!symbolRange && posStepper.isBefore(selectionEnd)) {
				// advance until next symbol
				const newPos = posStepper.translate(0, 1);
				if (document.validatePosition(newPos).isEqual(posStepper)) {
					// end of line, advance to start of next line
					posStepper = posStepper.with(posStepper.line + 1, 0);
				} else {
					// advance by 1 character
					posStepper = newPos;
				}
				symbolRange = document.getWordRangeAtPosition(posStepper);
			}
			if (posStepper.isAfterOrEqual(selectionEnd)) break;

			// add leads for current symbol
			const uri = document.uri;
			const symbol = document.getText(symbolRange);
			const symbolID = await addLeads(uri, posStepper, symbol).then(
				async fulfilled => await fulfilled,
				async rejected => await rejected
			);
			snippetEntry.snippetSymbols.push({ symbol: symbol, symbolID: symbolID });

			const oldPos = posStepper;
			posStepper = symbolRange!.end.translate(0, 1);
			if (oldPos.isEqual(posStepper)) {
				posStepper = posStepper.with(posStepper.line + 1, 0);
			}
		}

		snippetTable.push(snippetEntry);
		filterPanel.webview.postMessage({ command: "addSnippetFilter", label: snippetLabel });

		if (postSnippet) {
			// format snippet
			let snippet = document.getText(new vscode.Range(selectionStart, selectionEnd));
			let snippetLines: Array<string> = snippet.split(/\r\n/);
			const minIndent = Math.min(...snippetLines.filter(i => i.match(/[\S*]$/)).map(i => i.match(/\s*/)![0].length));
			snippetLines = snippetLines.map(i => i.slice(minIndent).concat("\n"));
			snippet = snippetLines.join('');
			
			// Format line numbers as range 
			const startLineNum = selectionStart.line + 1;
			const endLineNum = selectionEnd.line + 1;
			const lineNumbers = startLineNum === endLineNum ? `${startLineNum}` : `${startLineNum}-${endLineNum}`;
	
			snippetPanel.webview.postMessage({ 
				snippet: snippet, 
				snippetLabel: snippetLabel, 
				lineNumbers: lineNumbers, 
				fileName: fileName, 
				gitCommitInfo: gitCommitInfo,
				command: "addSnippet" 
			});

			// Auto-export snippet panel to file (independent of global state)
			autoExportSnippets().catch(error => {
				console.error('Error auto-exporting snippet panel:', error);
			});
		}

		// Note: Do not update history panel here - it's independent
	}

	// pin code snippet
	disposable = vscode.commands.registerCommand("pinSnippet", async () => pinSnippet(true));
	context.subscriptions.push(disposable);

	// show snippet history (triggered by CodeLens)
	disposable = vscode.commands.registerCommand("snippetHistory.show", (snippetId: string) => {
		const snippet = decorationManager.getSnippet(snippetId);
		if (snippet) {
			openSnippetInAnalysisPanel(snippet);
		}
	});
	context.subscriptions.push(disposable);

	// show team snippet history (triggered by CodeLens)
	disposable = vscode.commands.registerCommand("teamSnippetHistory.show", (teamSnippet: any) => {
		// Add team snippet to snippet panel
		snippetPanel.webview.postMessage({
			snippet: teamSnippet.code,
			snippetLabel: teamSnippet.label,
			lineNumbers: teamSnippet.lineNumbers,
			fileName: teamSnippet.fileName,
			gitCommitInfo: teamSnippet.gitCommitInfo,
			messages: teamSnippet.messages || [],
			command: "addSnippet"
		});

		vscode.window.showInformationMessage(`Added team snippet "${teamSnippet.label}" to snippet panel`);
	});
	context.subscriptions.push(disposable);

	// export snippets
	disposable = vscode.commands.registerCommand("exportSnippets", async () => {
		const exportData = decorationManager.exportSnippets();
		const saveUri = await vscode.window.showSaveDialog({
			filters: { 'JSON': ['json'] },
			defaultUri: vscode.Uri.file('snippets-export.json')
		});
		
		if (saveUri) {
			await vscode.workspace.fs.writeFile(saveUri, Buffer.from(exportData, 'utf8'));
			vscode.window.showInformationMessage(`Exported ${decorationManager.getAllSnippets().length} snippets to ${saveUri.fsPath}`);
		}
	});
	context.subscriptions.push(disposable);

	// manual auto-save command for testing
	disposable = vscode.commands.registerCommand("autoSaveSnippets", async () => {
		try {
			await autoExportSnippets();
			vscode.window.showInformationMessage("Snippets auto-saved successfully!");
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to auto-save snippets: ${error}`);
		}
	});
	context.subscriptions.push(disposable);

	// Debug command to force refresh team snippets and decorations
	disposable = vscode.commands.registerCommand("refreshTeamSnippets", () => {
		if (decorationManager) {
			decorationManager.forceUpdateDecorations();
			vscode.window.showInformationMessage("Team snippets refreshed!");
		}
	});
	context.subscriptions.push(disposable);

	// History panel message handler
	historyPanel.webview.onDidReceiveMessage(async message => {
		if (message.command === "requestHistoryUpdate") {
			updateHistoryPanel();
		} else if (message.command === "viewSnippet") {
			// Open snippet in the main snippet panel for viewing
			const snippet = message.snippet;
			
			// Add to decoration manager (global state) when viewing from history
			try {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(snippet.fileName));
				const startLine = snippet.lineNumbers.includes('-') 
					? parseInt(snippet.lineNumbers.split('-')[0]) - 1
					: parseInt(snippet.lineNumbers) - 1;
				const endLine = snippet.lineNumbers.includes('-') 
					? parseInt(snippet.lineNumbers.split('-')[1]) - 1
					: parseInt(snippet.lineNumbers) - 1;
				
				const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
				
				// Add to decoration manager with preserved notes
				const snippetId = await decorationManager.addSnippet(document, range, snippet.label, snippet.description);
				if (snippet.notes) {
					decorationManager.updateSnippetNotes(snippetId, snippet.notes);
				}
				
				vscode.window.showInformationMessage(`Added "${snippet.label}" to pinned snippets`);
			} catch (error) {
				console.error('Error adding snippet to decoration manager:', error);
			}
			
			// Also show in snippet panel
			snippetPanel.webview.postMessage({
				snippet: snippet.code,
				snippetLabel: snippet.label,
				lineNumbers: snippet.lineNumbers,
				fileName: snippet.fileName,
				gitCommitInfo: snippet.gitCommitInfo,
				messages: snippet.messages || [],
				command: "addSnippet"
			});
		} else if (message.command === "openSnippetInEditor") {
			// Navigate to the snippet location in the editor
			const snippet = message.snippet;
			try {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(snippet.fileName));
				const editor = await vscode.window.showTextDocument(document);
				
				// Parse line numbers and create range
				const [startLine, endLine] = snippet.lineNumbers.includes('-') 
					? snippet.lineNumbers.split('-').map((n: string) => parseInt(n) - 1)
					: [parseInt(snippet.lineNumbers) - 1, parseInt(snippet.lineNumbers) - 1];
				
				const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
				editor.selection = new vscode.Selection(range.start, range.end);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open snippet location: ${error}`);
			}
		} else if (message.command === "removeSnippet") {
			// Remove snippet from decoration manager and update panels
			console.log(`Attempting to remove snippet with ID: ${message.snippetId}`);
			
			// Check if snippet exists first
			const snippet = decorationManager.getSnippet(message.snippetId);
			if (!snippet) {
				console.error(`Snippet with ID ${message.snippetId} not found`);
				vscode.window.showErrorMessage(`Snippet "${message.snippetLabel}" not found`);
				return;
			}
			
			try {
				console.log(`Removing snippet: ${snippet.label} (ID: ${snippet.id})`);
				decorationManager.removeSnippet(message.snippetId);
				console.log(`Successfully removed snippet from decoration manager`);
				
				vscode.window.showInformationMessage(`Removed snippet "${message.snippetLabel}"`);
				updateHistoryPanel();
				console.log(`Updated history panel`);
				
				// Also trigger auto-save to persist the change
				autoExportSnippets().catch(error => {
					console.error('Error auto-saving after snippet removal:', error);
				});
			} catch (error) {
				console.error(`Error removing snippet:`, error);
				vscode.window.showErrorMessage(`Failed to remove snippet "${message.snippetLabel}": ${error}`);
			}
		} else if (message.command === "clearAllSnippets") {
			// Clear all snippets from decoration manager (history panel only)
			const allSnippets = decorationManager.getAllSnippets();
			for (const snippet of allSnippets) {
				decorationManager.removeSnippet(snippet.id);
			}
			historyPanel.webview.postMessage({ command: "clear" });
			vscode.window.showInformationMessage("All history panel snippets cleared");
			
			// Note: Do not clear snippet panel or trigger auto-export - they are independent
		} else if (message.command === "updateSnippetNotes") {
			// Update personal notes for a snippet
			console.log(`Updating notes for snippet ID: ${message.snippetId}`);
			
			const snippet = decorationManager.getSnippet(message.snippetId);
			if (snippet) {
				decorationManager.updateSnippetNotes(message.snippetId, message.notes);
				console.log(`Updated notes for snippet: ${snippet.label}`);
				
				// Trigger auto-save to persist the notes
				autoExportSnippets().catch(error => {
					console.error('Error auto-saving after updating notes:', error);
				});
			} else {
				console.error(`Snippet with ID ${message.snippetId} not found for notes update`);
			}
		}
	});

	// go to location on click from table
	leadsPanel.webview.onDidReceiveMessage(async message => {
		if (message.command === "leadClick") {
			const index = message.data.map((a: { data: string; }) => a.data);
			const location = locationTable.find(a => JSON.stringify(Object.values(a.key)) === JSON.stringify(index)).location;
			goToLocation(location.uri, location.range);
			
			await new Promise(resolve => setTimeout(resolve, 100));
			let referenceSet = new Set();
			if (index[0] === "incoming call") {
				const outCalls: any = await getOutgoingCalls();
				for (const outCall of outCalls) {
					const callRanges = outCall.fromRanges
					for (const callRange of callRanges) {
						const storedRanges = locationTable.map(item => item.location.range);
						for (const i in storedRanges) {
							if (callRange.contains(storedRanges[i])) referenceSet.add(locationTable[i].key);
						}
					}
				}
			}
			leadsPanel.webview.postMessage({ ref: Array.from(referenceSet), command: "sendToTop" });
		} else if (message.command === "clear") {
			locationTable = [];
			hiddenLeads = [];
			snippetTable = [];
			filterPanel.webview.postMessage({ command: "clear" });
			snippetPanel.webview.postMessage({ command: "clear" });
			openai.setMessageHistory([]);
		}
	});

	// toggle leads for symbol
	filterPanel.webview.onDidReceiveMessage(message => {
		if (message.type === "snippet") {
			const symbols: any[] = snippetTable.find(i => i.snippetLabel === message.symbol).snippetSymbols;
			if (message.command === "hide") {
				symbols.forEach(symbol => {
					hideLeads(symbol.symbolID);
				});
			} else if (message.command === "show") {
				symbols.forEach(symbol => {
					showLeads(symbol.symbolID);
				});
			}
			filterPanel.webview.postMessage({ command: message.command, type: message.type, symbolIDs: symbols.map(i => i.symbolID) });
		} else if (message.type === "symbol") {
			if (message.command === "hide") {
				hideLeads(message.symbolID);
			} else if (message.command === "show") {
				showLeads(message.symbolID);
			}
		}
		else if (message.command === "hideAll") {
			hiddenLeads = hiddenLeads.concat(locationTable);
			locationTable = [];
			leadsPanel.webview.postMessage({ command: "hideAllLeads" });
		}
	});

	function hideLeads(symbolID: number) {
		for (const lead of locationTable.filter(a => a.symbolID === symbolID)) {
			hiddenLeads.push(locationTable.splice(locationTable.indexOf(lead), 1)[0]);
		}
		leadsPanel.webview.postMessage({ symbolID: symbolID, command: "hideLeads" });
	}

	function showLeads(symbolID: number) {
		for (const hiddenLead of hiddenLeads.filter(a => a.symbolID === symbolID)) {
			locationTable.push(hiddenLeads.splice(hiddenLeads.indexOf(hiddenLead), 1)[0]);
		}
		const symbol = locationTable.filter(a => a.symbolID === symbolID).map(a => a.symbol);
		const restoredLeads = locationTable.filter(a => a.symbolID === symbolID).map(a => a.key);
		leadsPanel.webview.postMessage({ leads: restoredLeads, symbol: symbol, command: "addLead", symbolID: symbolID });
	}

	function goToSnippet(id: string): void {
		const snippet = decorationManager.getSnippet(id);
		if (snippet) {
			vscode.workspace.openTextDocument(vscode.Uri.file(snippet.fileName)).then(document => {
				vscode.window.showTextDocument(document).then(editor => {
					const range = snippet.range;
					editor.selection = new vscode.Selection(range.start, range.end);
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				});
			});
		}
	}

	function openSnippetInNewPanel(id: string): void {
		const snippet = decorationManager.getSnippet(id);
		if (snippet) {
			// Open the snippet in the full snippet panel for detailed analysis
			vscode.workspace.openTextDocument(vscode.Uri.file(snippet.fileName)).then(document => {
				const code = document.getText(snippet.range);
				const startLineNum = snippet.range.start.line + 1;
				const endLineNum = snippet.range.end.line + 1;
				const lineNumbers = startLineNum === endLineNum ? `${startLineNum}` : `${startLineNum}-${endLineNum}`;

				snippetPanel.webview.postMessage({
					snippet: code,
					snippetLabel: snippet.label,
					lineNumbers: lineNumbers,
					fileName: snippet.fileName,
					gitCommitInfo: snippet.gitCommitInfo,
					command: "addSnippet"
				});
			});
		}
	}

	snippetPanel.webview.onDidReceiveMessage(async message => {
		if (message.command === "snippetLabelChange") {
			filterPanel.webview.postMessage(message);
		} else if (message.command === "loadSnippet") {
			// Parse line numbers in range format (e.g., "8-14" or "8")
			const lineNumbers = message.lineNumbers;
			let start, end;
			if (lineNumbers.includes('-')) {
				const [startStr, endStr] = lineNumbers.split('-');
				start = Number(startStr);
				end = Number(endStr);
			} else {
				start = end = Number(lineNumbers);
			}
			const selection: vscode.Range = new vscode.Range(start - 1, 0, end, 0);
			const filepath = vscode.workspace.workspaceFolders![0].uri.path + message.fileName;
			const document: vscode.TextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(filepath));
			pinSnippet(false, document, selection, message.snippetLabel, filepath);
		} else if (message.command === "generateSummary") {
			snippetPanel.webview.postMessage({ command: message.command, output: await openai.generateOutput(message.instruction, message.snippet, message.type, message.confSkip, message.index) });
		} else if (message.command === "getMessageHistory") {
			snippetPanel.webview.postMessage({ command: message.command, messages: openai.getMessageHistory() });
		} else if (message.command === "setMessageHistory") {
			openai.setMessageHistory(message.messages);
			// Also update the snippet's messages in decoration manager if we can identify which snippet this is for
			// For now, we'll handle this through the snippet index if available
			if (message.index !== undefined) {
				const snippet = decorationManager.getSnippetByIndex(message.index);
				if (snippet) {
					decorationManager.updateSnippetMessages(snippet.id, message.messages[message.index] || []);
				}
			}
		} else if (message.command === "openDocumentation") {
			//vscode.commands.executeCommand("vscode.open", vscode.Uri.file(`${embeddingsLocation}\\..${message.filename}`));
			const fullPath = path.resolve(embeddingsLocation, "..", "..", message.filename);
			vscode.commands.executeCommand("vscode.open", vscode.Uri.file(fullPath));
		} else if (message.command === "saveToFile") {
			// Handle auto-save request from webview
			try {
				await vscode.workspace.fs.writeFile(
					vscode.Uri.file(message.filePath), 
					Buffer.from(message.data, 'utf8')
				);
				//console.log(`Auto-exported snippets to ${message.filePath}`);
			} catch (error) {
				console.error('Error writing auto-export file:', error);
			}
		} else if (message.command === "showImportNotification") {
			// Show notification about imported snippets
			if (message.count > 0) {
				vscode.window.showInformationMessage(`📌 Restored ${message.count} pinned snippets from previous session`);
			}
		} else if (message.command === "updateHistoryPanel") {
			// Update history panel when requested - but only from decoration manager, not snippet panel
			updateHistoryPanel();
		} else if (message.command === "removeSnippet") {
			// Handle snippet removal from snippet panel by index
			console.log(`Snippet removed from panel at index: ${message.index}`);
			
			// Note: Snippet panel is independent - just trigger auto-export to update file
			autoExportSnippets().catch(error => {
				console.error('Error auto-exporting after snippet panel removal:', error);
			});
			
			// Do not update decoration manager or history panel - they are independent
		} else if (message.command === "shareToTeam") {
			// Handle sharing a snippet to the team file
			try {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('No workspace folder found. Please open a workspace to share snippets.');
					return;
				}
				
				const teamFilePath = path.join(workspaceFolder.uri.fsPath, '.vscode-snippets-team.json');
				let existingTeamSnippets: any[] = [];
				
				// Read existing team snippets if file exists
				try {
					const existingContent = await vscode.workspace.fs.readFile(vscode.Uri.file(teamFilePath));
					const existingData = JSON.parse(existingContent.toString());
					existingTeamSnippets = existingData.snippets || [];
				} catch (readError) {
					// File doesn't exist or is invalid, start with empty array
					console.log('Creating new team snippets file or file was invalid:', readError);
				}
				
				// Check if snippet with same label already exists and ask user
				const existingIndex = existingTeamSnippets.findIndex(s => s.label === message.snippet.label);
				if (existingIndex >= 0) {
					const replace = await vscode.window.showWarningMessage(
						`A snippet with label "${message.snippet.label}" already exists in the team file. Do you want to replace it?`,
						'Replace', 'Cancel'
					);
					if (replace === 'Replace') {
						existingTeamSnippets[existingIndex] = message.snippet;
					} else {
						return; // User cancelled
					}
				} else {
					// Add new snippet
					existingTeamSnippets.push(message.snippet);
				}
				
				// Save updated team snippets
				const teamData = {
					snippets: existingTeamSnippets
				};
				
				await vscode.workspace.fs.writeFile(
					vscode.Uri.file(teamFilePath),
					Buffer.from(JSON.stringify(teamData, null, 2), 'utf8')
				);
				
				vscode.window.showInformationMessage(
					`Snippet "${message.snippet.label}" shared to team! 👥 (.vscode-snippets-team.json)`
				);
				
				console.log(`Shared snippet "${message.snippet.label}" to team file: ${teamFilePath}`);
				
				// Force refresh decorations to update the display
				if (decorationManager) {
					decorationManager.forceUpdateDecorations();
				}
				
			} catch (error) {
				console.error('Error sharing snippet to team:', error);
				vscode.window.showErrorMessage(`Failed to share snippet to team: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else if (message.command === "removeFromTeam") {
			// Handle removing a snippet from the team file
			try {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('No workspace folder found. Please open a workspace to remove team snippets.');
					return;
				}
				
				const teamFilePath = path.join(workspaceFolder.uri.fsPath, '.vscode-snippets-team.json');
				let existingTeamSnippets: any[] = [];
				
				// Read existing team snippets if file exists
				try {
					const existingContent = await vscode.workspace.fs.readFile(vscode.Uri.file(teamFilePath));
					const existingData = JSON.parse(existingContent.toString());
					existingTeamSnippets = existingData.snippets || [];
				} catch (readError) {
					// File doesn't exist or is invalid
					vscode.window.showWarningMessage('No team snippets file found.');
					return;
				}
				
				// Find and remove the snippet with the same label
				const snippetIndex = existingTeamSnippets.findIndex(s => s.label === message.snippetLabel);
				if (snippetIndex >= 0) {
					const removedSnippet = existingTeamSnippets.splice(snippetIndex, 1)[0];
					
					// Save updated team snippets
					const teamData = {
						snippets: existingTeamSnippets
					};
					
					await vscode.workspace.fs.writeFile(
						vscode.Uri.file(teamFilePath),
						Buffer.from(JSON.stringify(teamData, null, 2), 'utf8')
					);
					
					vscode.window.showInformationMessage(
						`Snippet "${removedSnippet.label}" removed from team! ❌ (.vscode-snippets-team.json)`
					);
					
					console.log(`Removed snippet "${removedSnippet.label}" from team file: ${teamFilePath}`);
					
					// Force refresh decorations to update the display
					if (decorationManager) {
						decorationManager.forceUpdateDecorations();
					}
					
				} else {
					vscode.window.showWarningMessage(`Snippet with label "${message.snippetLabel}" not found in team file.`);
				}
				
			} catch (error) {
				console.error('Error removing snippet from team:', error);
				vscode.window.showErrorMessage(`Failed to remove snippet from team: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else if (message.command === "loadTeamSnippets") {
			// Handle loading team snippets
			try {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('No workspace folder found. Please open a workspace to load team snippets.');
					return;
				}
				
				const teamFilePath = path.join(workspaceFolder.uri.fsPath, '.vscode-snippets-team.json');
				
				try {
					const teamFileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(teamFilePath));
					const teamData = teamFileContent.toString();
					
					// Send the team data to the snippet panel to load
					snippetPanel.webview.postMessage({
						command: "autoImport",
						data: teamData
					});
					
					console.log(`Loaded team snippets from: ${teamFilePath}`);
					
					// Show notification about loaded team snippets
					const teamSnippets = JSON.parse(teamData);
					if (teamSnippets.snippets && teamSnippets.snippets.length > 0) {
						vscode.window.showInformationMessage(`👥 Loaded ${teamSnippets.snippets.length} team snippets from .vscode-snippets-team.json`);
					}
					
				} catch (readError) {
					vscode.window.showWarningMessage('No team snippets file found (.vscode-snippets-team.json). Share some snippets first!');
					console.log('Team snippets file not found:', readError);
				}
				
			} catch (error) {
				console.error('Error loading team snippets:', error);
				vscode.window.showErrorMessage(`Failed to load team snippets: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else if (message.command === "syncSnippetMessages") {
			// Handle syncing messages to decoration manager by snippet label
			try {
				console.log(`Syncing messages for snippet: ${message.snippetLabel}`);
				
				// Find the snippet in decoration manager by label
				const allSnippets = decorationManager.getAllSnippets();
				const snippet = allSnippets.find(s => s.label === message.snippetLabel);
				
				if (snippet) {
					decorationManager.updateSnippetMessages(snippet.id, message.messages);
					console.log(`Updated messages for snippet: ${snippet.label} (ID: ${snippet.id})`);
				} else {
					console.log(`Snippet with label "${message.snippetLabel}" not found in decoration manager`);
				}
				
			} catch (error) {
				console.error('Error syncing snippet messages:', error);
			}
		}
	});
}

function getDefinition(uri?: vscode.Uri, pos?: vscode.Position): Thenable<lead.leadLocation[]> {
	return getSymbolInfo("vscode.executeDefinitionProvider", uri, pos);
}

function getReferences(uri?: vscode.Uri, pos?: vscode.Position): Thenable<vscode.Location[]> {
	return getSymbolInfo("vscode.executeReferenceProvider", uri, pos);
}

function getDeclaration(uri?: vscode.Uri, pos?: vscode.Position): Thenable<vscode.LocationLink[]> {
	return getSymbolInfo("vscode.executeDeclarationProvider", uri, pos);
}

function getIncomingCalls(uri?: vscode.Uri, pos?: vscode.Position) {
	return getSymbolCallHierarchy("vscode.provideIncomingCalls", uri, pos);
}

function getOutgoingCalls(uri?: vscode.Uri, pos?: vscode.Position) {
	return getSymbolCallHierarchy("vscode.provideOutgoingCalls", uri, pos);
}

function getSymbol(): string {
	const editor: vscode.TextEditor = vscode.window.activeTextEditor!;
	const symbol: string = editor.document.getText(
		editor.document.getWordRangeAtPosition(
			editor.selection.active
		)
	);
	return symbol;
}

async function getLeadData(uri: vscode.Uri, range: vscode.Range, type: string) {
	const document = await vscode.workspace.openTextDocument(uri);
	return {
		type: type,
		line: document.lineAt(range.start.line).text.trim(),
		fileName: uri.path.match(/(?<=\/)\w*\..*/)!.toString(),
		lineNumber: (range.start.line + 1),
		other: ""
	};
}

function addLocationEntry(arr: Array<any>, uri: vscode.Uri, range: vscode.Range, data: any, symbol: string, symbolID: number): void {
	arr.push({ key: data, location: { uri: uri, range: range }, symbol: symbol, symbolID: symbolID });
	return;
}

function getSymbolInfo(commandId: string, uri?: vscode.Uri, pos?: vscode.Position): Thenable<any> {
	const callingEditor: vscode.TextEditor = vscode.window.activeTextEditor!;
	if (!uri) uri = callingEditor.document.uri;
	if (!pos) pos = callingEditor.selection.active;
	return vscode.commands.executeCommand(
		commandId,
		uri,
		pos
	);
}

async function getSymbolCallHierarchy(commandId: string, uri?: vscode.Uri, pos?: vscode.Position) {
	const callingEditor: vscode.TextEditor = vscode.window.activeTextEditor!;
	if (!uri) uri = callingEditor.document.uri;
	if (!pos) pos = callingEditor.selection.active;
	const callHierarchyItem = await vscode.commands.executeCommand(
		"vscode.prepareCallHierarchy",
		uri,
		pos
	).then(result => result);
	return await vscode.commands.executeCommand(commandId, (callHierarchyItem as Array<any>)[0]);
}

function goToLocation(uri: vscode.Uri, range: vscode.Range): void {
	vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
	vscode.commands.executeCommand(
		"editor.action.goToLocations",
		uri,
		range.start,
		[new vscode.Location(uri, range.start)]
	);
}

function webviewSetup(title: string, position: vscode.ViewColumn, extensionUri: vscode.Uri, relativePath: string): vscode.WebviewPanel {
	let panel: vscode.WebviewPanel = vscode.window.createWebviewPanel(
		"[viewtype]",
		title,
		{viewColumn: position, preserveFocus: true},
		{enableScripts: true, retainContextWhenHidden: true}
	);
	getWebviewContent(extensionUri, relativePath).then(document => {
		const styles = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "src", "styles.css"));
		panel.webview.html = document.getText().replace("styles.css", styles.toString());
	});
	return panel;
}

function positionWebviewTabs(): void {
	vscode.commands.executeCommand("workbench.action.focusRightGroup");
	vscode.commands.executeCommand("workbench.action.focusBelowGroup");
	vscode.commands.executeCommand("workbench.action.moveActiveEditorGroupDown");
	vscode.commands.executeCommand("workbench.action.previousEditor");
	vscode.commands.executeCommand("workbench.action.previousEditor");
	vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
}

function getWebviewContent(extensionUri: vscode.Uri, relativePath: string): Thenable<vscode.TextDocument> {
	return vscode.workspace.openTextDocument(vscode.Uri.joinPath(extensionUri, relativePath));
}

// Called at deactivation
export async function deactivate() {
	// Auto-export snippets before deactivation (with proper async handling)
	try {
		await autoExportSnippets();
		console.log('Successfully exported snippets on deactivation');
	} catch (error) {
		console.error('Error during auto-export on deactivation:', error);
	}
	
	if (decorationManager) {
		decorationManager.dispose();
	}
}
