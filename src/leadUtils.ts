import * as vscode from 'vscode';

export type leadLocation = vscode.Location | vscode.LocationLink | vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall;

export function getLocationData(location: leadLocation): { uri: vscode.Uri, range: vscode.Range } {
    if (location instanceof vscode.Location) {
        return { uri: location.uri, range: location.range };
    } else if (location instanceof vscode.CallHierarchyIncomingCall) {
        return { uri: location.from.uri, range: location.from.selectionRange };
    } else if (location instanceof vscode.CallHierarchyOutgoingCall) {
        return { uri: location.to.uri, range: location.to.selectionRange };
    } else {
        return { uri: location.targetUri, range: location.targetSelectionRange! };
    }
}
