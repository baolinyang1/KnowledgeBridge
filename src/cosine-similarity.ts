function dotProduct(a: number[], b: number[]): number {
	let dotProd: number = 0;
	for (const i in a) {
		dotProd += a[i] * b[i];
	}
	return dotProd;
}

function magnitude(a: number[]): number {
	return Math.sqrt(dotProduct(a, a));
}

export function cosineSimilarity(a: number[], b: number[]): number {
	return dotProduct(a, b) / (magnitude(a) * magnitude(b));
}