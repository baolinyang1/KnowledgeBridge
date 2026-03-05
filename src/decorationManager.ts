import * as vscode from 'vscode';
import * as gitUtils from './gitUtils';
import * as path from 'path';

export interface PinnedSnippet {
    id: string;
    label: string;
    description: string;
    fileName: string;
    range: vscode.Range;
    gitCommitInfo: gitUtils.GitCommitInfo | null;
    timestamp: Date;
    messages?: any[];
    notes?: string;
}

class SnippetCodeLensProvider implements vscode.CodeLensProvider {
    private decorationManager: DecorationManager;

    constructor(decorationManager: DecorationManager) {
        this.decorationManager = decorationManager;
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const fileName = document.uri.path;
        const snippets = this.decorationManager.getSnippetsForFile(fileName);
        
        // Get both personal and team CodeLenses
        const personalCodeLenses = snippets.map(snippet => {
            const range = new vscode.Range(snippet.range.start.line, snippet.range.start.character, snippet.range.start.line, snippet.range.start.character);
            const command: vscode.Command = {
                title: '📋 Personal History',
                command: 'snippetHistory.show',
                arguments: [snippet.id]
            };
            return new vscode.CodeLens(range, command);
        });

        const teamCodeLenses = this.decorationManager.getTeamCodeLenses(fileName);
        
        return [...personalCodeLenses, ...teamCodeLenses];
    }
}

export class DecorationManager {
    private decorations: Map<string, vscode.TextEditorDecorationType> = new Map();
    private snippets: Map<string, PinnedSnippet> = new Map();
    private teamCodeLenses: Map<string, vscode.CodeLens[]> = new Map();
    private decorationType: vscode.TextEditorDecorationType;
    private pinIconDecorationType: vscode.TextEditorDecorationType;
    private teamDecorationType: vscode.TextEditorDecorationType;
    private teamPinIconDecorationType: vscode.TextEditorDecorationType;
    private context: vscode.ExtensionContext;
    private codeLensProvider: SnippetCodeLensProvider;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;

        // Create a decoration type for pinned snippets (background highlight)
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            borderRadius: '3px',
            border: '1px solid',
            borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
            isWholeLine: false
        });

        // Create a separate decoration type for the pin icon
        this.pinIconDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: '📌',
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontWeight: 'bold'
            },
            isWholeLine: false
        });

        // Create decoration types for team snippets (different colors)
        this.teamDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
            borderRadius: '3px',
            border: '1px solid',
            borderColor: new vscode.ThemeColor('editor.wordHighlightBorder'),
            isWholeLine: false,
            opacity: '0.7'
        });

        // Team pin icon with different color and icon
        this.teamPinIconDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ' 👥',
                color: new vscode.ThemeColor('editorInfo.foreground'),
                fontWeight: 'bold'
            },
            isWholeLine: false
        });

        // Setup CodeLens provider for entry points
        this.codeLensProvider = new SnippetCodeLensProvider(this);
        vscode.languages.registerCodeLensProvider('*', this.codeLensProvider);

        // Listen for editor changes to update decorations
        vscode.window.onDidChangeActiveTextEditor(this.updateDecorations, this);
        vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange, this);

        // Don't auto-load persisted snippets in constructor - will be done via initialize()
    }

    async initialize(): Promise<void> {
        // Load persisted snippets
        await this.loadPersistedSnippets();
        // Team snippets are now loaded on-demand when files are opened
    }

    // Force update decorations for the current active editor
    forceUpdateDecorations(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.updateDecorations();
        }
    }

    async addSnippet(
        document: vscode.TextDocument,
        range: vscode.Range,
        label?: string,
        description?: string
    ): Promise<string> {
        const id = this.generateId();
        const fileName = document.uri.path;

        // Get git information
        let gitCommitInfo: gitUtils.GitCommitInfo | null = null;
        try {
            const isGitRepo = await gitUtils.isGitRepository();
            if (isGitRepo) {
                gitCommitInfo = await gitUtils.getGitCommitInfo(
                    document.uri.fsPath,
                    range.start.line + 1,
                    range.end.line + 1
                );
            }
        } catch (error) {
            console.error('Error getting git commit info:', error);
        }

        const snippet: PinnedSnippet = {
            id,
            label: label || (() => {
                // Generate label using format: snippet-filename-linenumber
                const fileBaseName = path.basename(fileName, path.extname(fileName));
                const startLineNumber = range.start.line + 1;
                const endLineNumber = range.end.line + 1;
                const lineRange = startLineNumber === endLineNumber ? `${startLineNumber}` : `${startLineNumber}-${endLineNumber}`;
                return `snippet-${fileBaseName}-${lineRange}`;
            })(),
            description: description || '',
            fileName,
            range,
            gitCommitInfo,
            timestamp: new Date(),
            messages: []
        };

        this.snippets.set(id, snippet);
        this.updateDecorations();
        await this.persistSnippets();

        return id;
    }

    removeSnippet(id: string): void {
        this.snippets.delete(id);
        this.updateDecorations();
        this.persistSnippets();
    }

    getSnippet(id: string): PinnedSnippet | undefined {
        return this.snippets.get(id);
    }

    getAllSnippets(): PinnedSnippet[] {
        return Array.from(this.snippets.values()).sort((a, b) => 
            b.timestamp.getTime() - a.timestamp.getTime()
        );
    }

    getSnippetsForFile(fileName: string): PinnedSnippet[] {
        return this.getAllSnippets().filter(snippet => snippet.fileName === fileName);
    }

    updateSnippetMessages(id: string, messages: any[]): void {
        const snippet = this.snippets.get(id);
        if (snippet) {
            snippet.messages = messages;
            this.persistSnippets();
        }
    }

    updateSnippetNotes(id: string, notes: string): void {
        const snippet = this.snippets.get(id);
        if (snippet) {
            snippet.notes = notes;
            this.persistSnippets();
        }
    }

    getSnippetByIndex(index: number): PinnedSnippet | undefined {
        const snippets = this.getAllSnippets();
        return snippets[index];
    }

    private updateDecorations(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        const fileName = activeEditor.document.uri.path;
        const fileSnippets = this.getSnippetsForFile(fileName);
        
        console.log(`Updating decorations for file: ${fileName}`);
        console.log(`Personal snippets: ${fileSnippets.length}`);
        
        // Actively scan for team snippets for this file (async)
        this.scanAndApplyTeamSnippetsForFile(fileName, activeEditor).catch(error => {
            console.error('Error applying team snippets:', error);
        });
        
        // Personal snippets decorations
        const decorations: vscode.DecorationOptions[] = fileSnippets.map(snippet => ({
            range: snippet.range,
            hoverMessage: new vscode.MarkdownString([
                `**${snippet.label}** (Personal)`,
                snippet.description ? `*${snippet.description}*` : '',
                snippet.gitCommitInfo ? `\`${snippet.gitCommitInfo.hash}\` by ${snippet.gitCommitInfo.author}` : '',
                `*Pinned: ${snippet.timestamp.toLocaleString()}*`
            ].filter(Boolean).join('\n\n'))
        }));

        activeEditor.setDecorations(this.decorationType, decorations);

        // Personal pin icon decorations
        const pinIconDecorations: vscode.DecorationOptions[] = fileSnippets.map(snippet => ({
            range: new vscode.Range(snippet.range.start.line, snippet.range.start.character, snippet.range.start.line, snippet.range.start.character)
        }));
        activeEditor.setDecorations(this.pinIconDecorationType, pinIconDecorations);
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        // Update snippet ranges when document changes
        const fileName = event.document.uri.path;
        const fileSnippets = this.getSnippetsForFile(fileName);

        for (const snippet of fileSnippets) {
            // Simple range adjustment - could be made more sophisticated
            for (const change of event.contentChanges) {
                if (change.range.start.line <= snippet.range.start.line) {
                    const lineDelta = change.text.split('\n').length - 1 - (change.range.end.line - change.range.start.line);
                    if (lineDelta !== 0) {
                        const newStart = new vscode.Position(
                            snippet.range.start.line + lineDelta,
                            snippet.range.start.character
                        );
                        const newEnd = new vscode.Position(
                            snippet.range.end.line + lineDelta,
                            snippet.range.end.character
                        );
                        snippet.range = new vscode.Range(newStart, newEnd);
                    }
                }
            }
        }

        this.updateDecorations();
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    exportSnippets(): string {
        const exportData = {
            snippets: this.getAllSnippets().map(snippet => ({
                ...snippet,
                range: {
                    start: { line: snippet.range.start.line, character: snippet.range.start.character },
                    end: { line: snippet.range.end.line, character: snippet.range.end.character }
                }
            })),
            exportedAt: new Date().toISOString()
        };
        return JSON.stringify(exportData, null, 2);
    }

    private async persistSnippets(): Promise<void> {
        try {
            const snippetsData = this.exportSnippets();
            await this.context.globalState.update('pinnedSnippets', snippetsData);
        } catch (error) {
            console.error('Error persisting snippets:', error);
        }
    }

    private async loadPersistedSnippets(): Promise<void> {
        try {
            const snippetsData = this.context.globalState.get<string>('pinnedSnippets');
            if (snippetsData) {
                this.importSnippets(snippetsData);
            }
        } catch (error) {
            console.error('Error loading persisted snippets:', error);
        }
    }

    importSnippets(jsonData: string): void {
        try {
            const data = JSON.parse(jsonData);
            for (const snippetData of data.snippets) {
                const range = new vscode.Range(
                    new vscode.Position(snippetData.range.start.line, snippetData.range.start.character),
                    new vscode.Position(snippetData.range.end.line, snippetData.range.end.character)
                );
                
                const snippet: PinnedSnippet = {
                    ...snippetData,
                    range,
                    timestamp: new Date(snippetData.timestamp)
                };
                
                this.snippets.set(snippet.id, snippet);
            }
            this.updateDecorations();
            this.persistSnippets();
        } catch (error) {
            console.error('Error importing snippets:', error);
        }
    }

    dispose(): void {
        this.decorationType.dispose();
        this.pinIconDecorationType.dispose();
        this.teamDecorationType.dispose();
        this.teamPinIconDecorationType.dispose();
    }

    private async scanAndApplyTeamSnippetsForFile(fileName: string, activeEditor: vscode.TextEditor): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }

            const teamFilePath = path.join(workspaceFolders[0].uri.fsPath, '.vscode-snippets-team.json');
            
            try {
                const teamFileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(teamFilePath));
                const teamData = JSON.parse(teamFileContent.toString());
                
                console.log(`Scanning team snippets for file: ${fileName}`);
                
                const teamDecorations: vscode.DecorationOptions[] = [];
                const teamPinIconDecorations: vscode.DecorationOptions[] = [];
                const teamCodeLenses: vscode.CodeLens[] = [];
                
                // Find snippets that match this file
                for (const snippetData of teamData.snippets || []) {
                    // Check if this snippet belongs to the current file
                    let matches = false;
                    
                    // Handle relative path matching
                    if (!path.isAbsolute(snippetData.fileName)) {
                        const absolutePath = path.join(workspaceFolders[0].uri.fsPath, snippetData.fileName);
                        console.log(`absoulte path ${absolutePath}`)
                        matches = true;
                    } else {
                        console.log(`compare ${fileName} with ${snippetData.fileName} `)
                        matches = true;
                    }
                    
                    if (matches) {
                        console.log(`Found team snippet for current file: ${snippetData.label}`);
                        
                        // Create range from line numbers
                        let range: vscode.Range;
                        if (snippetData.lineNumbers) {
                            const lineNumbers = snippetData.lineNumbers;
                            let startLine, endLine;
                            if (lineNumbers.includes('-')) {
                                const [startStr, endStr] = lineNumbers.split('-');
                                startLine = Number(startStr) - 1;
                                endLine = Number(endStr) - 1;
                            } else {
                                startLine = endLine = Number(lineNumbers) - 1;
                            }
                            
                            // Get actual line content for proper range
                            try {
                                const endLineText = activeEditor.document.lineAt(endLine).text;
                                range = new vscode.Range(startLine, 0, endLine, endLineText.length);
                            } catch {
                                range = new vscode.Range(startLine, 0, endLine, 999);
                            }
                        } else {
                            range = new vscode.Range(0, 0, 0, 999);
                        }
                        
                        // Add team decoration
                        teamDecorations.push({
                            range,
                            hoverMessage: new vscode.MarkdownString([
                                `**${snippetData.label}** (Team Shared) 👥`,
                                snippetData.description ? `*${snippetData.description}*` : '',
                                snippetData.gitCommitInfo ? `\`${snippetData.gitCommitInfo.hash}\` by ${snippetData.gitCommitInfo.author}` : '',
                                `From team snippets, you can click import tram snippets button to import`
                            ].filter(Boolean).join('\n\n'))
                        });
                        
                        // Add team pin icon decoration
                        teamPinIconDecorations.push({
                            range: new vscode.Range(range.start.line, range.start.character, range.start.line, range.start.character)
                        });

                        // Add team CodeLens
                        const command: vscode.Command = {
                            title: '👥📋Team History',
                            command: 'teamSnippetHistory.show',
                            arguments: [snippetData]
                        };
                        teamCodeLenses.push(new vscode.CodeLens(new vscode.Range(range.start.line, range.start.character, range.start.line, range.start.character), command));
                    }
                }
                
                console.log(`Applying ${teamDecorations.length} team decorations to ${fileName}`);
                activeEditor.setDecorations(this.teamDecorationType, teamDecorations);
                activeEditor.setDecorations(this.teamPinIconDecorationType, teamPinIconDecorations);
                this.teamCodeLenses.set(fileName, teamCodeLenses);
                
            } catch (readError) {
                console.log('No team snippets file found or invalid format');
            }
            
        } catch (error) {
            console.error('Error scanning team snippets:', error);
        }
    }

    getTeamCodeLenses(fileName: string): vscode.CodeLens[] {
        return this.teamCodeLenses.get(fileName) || [];
    }
} 