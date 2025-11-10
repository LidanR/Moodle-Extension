// Background script to handle opening options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === 'openOptions') {
		chrome.runtime.openOptionsPage();
		sendResponse({success: true});
	}
	return true;
});

