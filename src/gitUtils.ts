import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitCommitInfo {
    hash: string;
    author: string;
    email: string;
    date: string;
    subject: string;
}

/**
 * Get the git commit information for a specific line range in a file
 */
export async function getGitCommitInfo(filePath: string, startLine: number, endLine: number): Promise<GitCommitInfo | null> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        const relativePath = filePath.replace(workspacePath, '').replace(/^[\/\\]/, '');

        // Use git blame to get commit info for the line range
        // We'll get info for the middle line of the selection
        const targetLine = Math.floor((startLine + endLine) / 2);
        
        const blameCommand = `git blame -L ${targetLine},${targetLine} --porcelain "${relativePath}"`;
        const { stdout } = await execAsync(blameCommand, { cwd: workspacePath });
        
        if (!stdout) {
            return null;
        }

        const lines = stdout.split('\n');
        const commitHash = lines[0].split(' ')[0];
        
        if (commitHash === '0000000000000000000000000000000000000000') {
            // Uncommitted changes
            return {
                hash: 'uncommitted',
                author: 'Local changes',
                email: '',
                date: new Date().toISOString(),
                subject: 'Uncommitted changes'
            };
        }

        // Get detailed commit information
        const logCommand = `git log -1 --format="%H|%an|%ae|%ai|%s" ${commitHash}`;
        const { stdout: logOutput } = await execAsync(logCommand, { cwd: workspacePath });
        
        if (!logOutput) {
            return null;
        }

        const [hash, author, email, date, subject] = logOutput.trim().split('|');
        return {
            hash: hash,
            author,
            email,
            date,
            subject
        };

    } catch (error) {
        console.error('Error getting git commit info:', error);
        return null;
    }
}

/**
 * Check if the current workspace is a git repository
 */
export async function isGitRepository(): Promise<boolean> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', { 
            cwd: workspaceFolder.uri.fsPath 
        });
        
        return stdout.trim() === 'true';
    } catch (error) {
        return false;
    }
} 