const express = require('express');
const { Octokit } = require("@octokit/rest");
const bodyParser = require('body-parser');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// GitHub token and repo info
const githubToken = '*********************';
const owner = 'GurpinderSandhu';
const repo = 'practice';

// Initialize GitHub API client
const octokit = new Octokit({ auth: githubToken });

// Define webhook endpoint
app.post('/webhook', async (req, res) => {
  	const issueKey = req.query.issueKey;
	const featureFlagFile = `${req.query.featureFlagName}.json`;
	const releaseVersion = req.query.releaseVersion;
  
	try {
		// 1. Get the latest commit SHA from the main branch
		const { data: latestCommit } = await octokit.repos.getCommit({
			owner,
			repo,
			ref: 'main',
		});

		// 2. Create a new branch based on the latest commit
		const branchName = `testbranch${Math.floor(Math.random() * 10000001)}`;
		await octokit.git.createRef({
			owner,
			repo,
			ref: `refs/heads/${branchName}`,
			sha: latestCommit.sha,
		});

		// 3. Fetch file details
		const filePath =  await getFilePath(owner, repo, featureFlagFile);
		console.log(filePath);
		const { data: fileData } = await octokit.repos.getContent({
			owner,
			repo,
			path: filePath,
			ref: 'main',
		});

		const fileContent = Buffer.from(fileData.content, 'base64').toString('utf8');
		const jsonData = JSON.parse(fileContent);

		if ( releaseVersion ) {
			if ( "rules" in jsonData.environments.production ) {
				jsonData.environments.production.rules.push({
					"variation": true,
					"versions": {
						"start": `${releaseVersion}.0`
					}
				})
			} else {
				jsonData.environments.production.rules = {
					"variation": true,
					"versions": {
						"start": `${releaseVersion}.0`
					}
				}
			}
		} else {
			jsonData.environments.production.defaultVariation = "true";
		}
		const modifiedContent = customStringify(jsonData);
		const encodedContent = Buffer.from(modifiedContent).toString('base64');

		// 4. Commit the changes
		await octokit.repos.createOrUpdateFileContents({
			owner,
			repo,
			path: filePath,
			message: `Turn on flag for ${issueKey}`,
			content: encodedContent,
			sha: fileData.sha,
			branch: branchName,
		});

		// 5. Create a pull request with the new branch
		const pullRequest = await octokit.pulls.create({
			owner,
			repo,
			title: `${issueKey} > PR for Feature Flags`,
			head: branchName,
			base: 'main',
			body: `This PR contains changes for feature flags as part of Jira issue ${issueKey}.`,
		});

		// Respond with the URL of the created pull request
		res.status(200).send({ message: 'PR created successfully', prUrl: pullRequest.data.html_url });

	} catch (error) {
		console.error('Error processing webhook:', error);
		res.status(500).send('Error processing webhook');
}
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  	console.log(`Server running on port ${PORT}`);
});

async function getFilePath(owner, repo, fileName) {
	try {
		// Retrieve the contents of the repository's root directory (or a specific path if needed)
		const { data } = await octokit.repos.getContent({
			owner: owner,
			repo: repo,
			path: '', // You can specify a directory path if you're looking within a subfolder
		});

		// Look through the contents and search for the file name
		for (const file of data) {
			if (file.name === fileName) {
				console.log('File path found:', file.path);
				return file.path;
			}
		}

		console.log('File not found');
		return null;
	} catch (error) {
		console.error('Error retrieving file path:', error);
	}
}

function customStringify(obj) {
	// Stringify with indentation of 4 spaces first
	let jsonString = JSON.stringify(obj, null, 4);

	// Replace spaces with tabs for indentation
	jsonString = jsonString.replace(/    /g, '\t');

	// Ensure the final newline
	if (!jsonString.endsWith('\n')) {
		jsonString += '\n';
	}
	// Replace Windows-style line endings with LF (if any)
	jsonString = jsonString.replace(/\r\n/g, '\n');

	return jsonString;
}

