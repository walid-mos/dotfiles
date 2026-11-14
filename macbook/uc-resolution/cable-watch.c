#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { MAX_PEER_LINKS = 8, MODEL_LENGTH = 64 };

static const char *const LINK_CLASS = "IOThunderboltXDomainLink";

static const char *peerModel;
static uint64_t peerLinks[MAX_PEER_LINKS];
static int peerLinkCount;
static int reportedPresence = -1;

static bool isPeer(io_service_t link) {
	char model[MODEL_LENGTH] = "";
	CFTypeRef name = IORegistryEntryCreateCFProperty(link, CFSTR("Device Name"), kCFAllocatorDefault, 0);
	if (name == NULL) return false;
	bool isMatch = CFGetTypeID(name) == CFStringGetTypeID()
		&& CFStringGetCString(name, model, sizeof model, kCFStringEncodingUTF8)
		&& strcmp(model, peerModel) == 0;
	CFRelease(name);
	return isMatch;
}

static void addPeerLinks(io_iterator_t links) {
	io_service_t link;
	while ((link = IOIteratorNext(links))) {
		uint64_t id;
		if (peerLinkCount < MAX_PEER_LINKS && isPeer(link) && IORegistryEntryGetRegistryEntryID(link, &id) == KERN_SUCCESS)
			peerLinks[peerLinkCount++] = id;
		IOObjectRelease(link);
	}
}

static void forgetPeerLink(uint64_t id) {
	for (int index = 0; index < peerLinkCount; index++) {
		if (peerLinks[index] != id) continue;
		peerLinks[index] = peerLinks[--peerLinkCount];
		return;
	}
}

static void removePeerLinks(io_iterator_t links) {
	io_service_t link;
	while ((link = IOIteratorNext(links))) {
		uint64_t id;
		if (IORegistryEntryGetRegistryEntryID(link, &id) == KERN_SUCCESS) forgetPeerLink(id);
		IOObjectRelease(link);
	}
}

static void reportPresence(void) {
	int presence = peerLinkCount > 0;
	if (presence == reportedPresence) return;
	reportedPresence = presence;
	printf("cable %d\n", presence);
	fflush(stdout);
}

static void onLinksAdded(void *refcon, io_iterator_t links) {
	addPeerLinks(links);
	reportPresence();
}

static void onLinksRemoved(void *refcon, io_iterator_t links) {
	removePeerLinks(links);
	reportPresence();
}

static io_iterator_t watchLinks(IONotificationPortRef port, const char *notification, IOServiceMatchingCallback callback) {
	io_iterator_t links;
	kern_return_t result = IOServiceAddMatchingNotification(port, notification, IOServiceMatching(LINK_CLASS), callback, NULL, &links);
	if (result == KERN_SUCCESS) return links;
	fprintf(stderr, "cable-watch: cannot watch %s %s (0x%x)\n", LINK_CLASS, notification, result);
	exit(1);
}

int main(int argc, char **argv) {
	if (argc != 2) {
		fprintf(stderr, "usage: cable-watch <peer model identifier, e.g. Mac13,1>\n");
		return 2;
	}
	peerModel = argv[1];
	IONotificationPortRef port = IONotificationPortCreate(kIOMainPortDefault);
	CFRunLoopAddSource(CFRunLoopGetCurrent(), IONotificationPortGetRunLoopSource(port), kCFRunLoopDefaultMode);
	io_iterator_t added = watchLinks(port, kIOFirstMatchNotification, onLinksAdded);
	io_iterator_t removed = watchLinks(port, kIOTerminatedNotification, onLinksRemoved);
	removePeerLinks(removed);
	addPeerLinks(added);
	reportPresence();
	CFRunLoopRun();
	return 1;
}
