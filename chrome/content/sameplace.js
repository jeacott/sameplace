/*
  Copyright (C) 2005-2006 by Massimiliano Mirra

  This program is free software; you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation; either version 2 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301 USA

  Author: Massimiliano Mirra, <bard [at] hyperstruct [dot] net>
*/


// GLOBAL DEFINITIONS
// ----------------------------------------------------------------------

const Cc = Components.classes;
const Ci = Components.interfaces;

const prefBranch = Cc["@mozilla.org/preferences-service;1"]
    .getService(Ci.nsIPrefService)
    .getBranch('extensions.sameplace.');
const srvPrompt = Cc["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Ci.nsIPromptService);

const ns_muc_user = 'http://jabber.org/protocol/muc#user';
const ns_muc      = 'http://jabber.org/protocol/muc';
const ns_xul      = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const ns_roster   = 'jabber:iq:roster';
const ns_xhtml_im = 'http://jabber.org/protocol/xhtml-im';
const ns_xhtml    = 'http://www.w3.org/1999/xhtml';


// GLOBAL STATE
// ----------------------------------------------------------------------

var channel;


// GUI INITIALIZATION AND FINALIZATION
// ----------------------------------------------------------------------

function init(event) {
    if(!event.target)
        return;

    channel = XMPP.createChannel(
        <query xmlns="http://jabber.org/protocol/disco#info">
        <feature var="http://jabber.org/protocol/muc"/>
        <feature var="http://jabber.org/protocol/muc#user"/>
        <feature var='http://jabber.org/protocol/xhtml-im'/>
        </query>);

    channel.on(
        {event: 'presence', direction: 'out', stanza: function(s) {
                return (s.@type == undefined || s.@type == 'unavailable') &&
                    s.ns_muc::x == undefined && s.@to == undefined;
            }},
        function(presence) { sentAvailablePresence(presence) });
    channel.on(
        {event: 'message', direction: 'in', stanza: function(s) {
                return s.body.length() > 0 && s.@type != 'error';
            }}, function(message) { seenChatMessage(message); });
    channel.on(
        {event: 'message', direction: 'out', stanza: function(s) {
                return s.body.length() > 0 && s.@type != 'groupchat';
            }}, function(message) { seenChatMessage(message) });
    channel.on(
        {event: 'presence', direction: 'out', stanza: function(s) {
                return s.ns_muc::x.length() > 0 && s.@type != 'unavailable';
            }}, function(presence) { sentMUCPresence(presence) });

    contacts = _('contacts').contentWindow;
    contacts.onRequestedCommunicate = requestedCommunicate;

    XMPP.cache.presenceOut.forEach(sentAvailablePresence);

    _('conversations').addEventListener(
        'DOMNodeInserted', function(event) {
            _('conversations').collapsed = 
                (_('conversations').childNodes.length == 0);
        }, false);

    _('conversations').addEventListener(
        'DOMNodeRemoved', function(event) {
            _('conversations').collapsed = 
                (_('conversations').childNodes.length == 0);
        }, false);

}

function finish() {
    for(var conversation, i=0; conversation = _('conversations').childNodes[i]; i++)
        closeConversation(
            attr(conversation, 'account'), attr(conversation, 'address'));

    channel.release();
}


// GUI UTILITIES (GENERIC)
// ----------------------------------------------------------------------
// Application-independent functions dealing with user interface.

function queuePostLoadAction(contentPanel, action) {
    contentPanel.addEventListener(
        'load', function(event) {
            if(event.target != contentPanel.contentDocument)
                return;

            // The following appears not to work if reference to
            // contentPanel is not the one carried by event object.
            contentPanel = event.currentTarget;
            contentPanel.contentWindow.addEventListener(
                'load', function(event) {
                    action(contentPanel);
                }, false);
        }, true);
}

function hasAncestor(element, parentName, parentNamespace) {
    var elementDoc = element.ownerDocument;
    while(element != elementDoc) {
        if(element.localName == parentName &&
           (!parentNamespace || element.isDefaultNamespace(parentNamespace)))
            return element;
        element = element.parentNode;
    }
    return false;
}


// GUI UTILITIES (SPECIFIC)
// ----------------------------------------------------------------------
// Application-dependent functions dealing with interface.  They do
// not affect the domain directly.

function getDefaultAppUrl() {
    var url = prefBranch.getCharPref('defaultAppUrl');
    return isChromeUrl(url) ? chromeToFileUrl(url) : url;
}

function getBrowser() {
    return top.getBrowser();
}

function getTop() {
    return top;
}

function isConversationOpen(account, address) {
    return getConversation(account, address) != undefined;
}

function isConversationCurrent(account, address) {
    return _('conversations').selectedPanel == getConversation(account, address);
}

function withConversation(account, address, resource, type, forceOpen, action) {
    var conversation = getConversation(account, address);

    if(!conversation && forceOpen)
        openAttachPanel(
            account, address, resource, type,
            getDefaultAppUrl(),
            'sidebar', function(contentPanel) {
                action(contentPanel);
                openedConversation(account, address, type);
            });
    else
        action(_(conversation, {role: 'chat'}).contentDocument);
}

if(typeof(x) == 'function') {
    function getConversation(account, address) {    
        return x('//*[@id="conversations"]' +
                 '//*[@account="' + account + '" and ' +
                 '    @address="' + address + '"]');
    }
} else {
    function getConversation(account, address){
        var conversationsForAccount =
            _('conversations').getElementsByAttribute('account', account);
        for(var i=0; i<conversationsForAccount.length; i++){
            if(conversationsForAccount[i].getAttribute('address') == address)
                return conversationsForAccount[i];
        }
    }
}


// GUI ACTIONS
// ----------------------------------------------------------------------
// Application-dependent functions dealing with user interface.  They
// affect the domain.

function openInBrowser(url, newTab) {
    if(url.match(/^javascript:/)) {
        srvPrompt.alert(
            window, 'SamePlace: Security Notification',
            'This link contains javascript code and has been disabled as a security measure.');
        return;
    }

    if(newTab) 
        getBrowser().selectedTab = getBrowser().addTab(url);        
    else
        getBrowser().loadURI(url);
}

function updateAttachTooltip() {
    _('attach-tooltip', {role: 'message'}).value =
        'Make this conversation channel available to ' +
        getBrowser().currentURI.spec;
}

function changeStatusMessage(message) {
    for each(var account in XMPP.accounts)
        if(XMPP.isUp(account)) {
            var stanza;
            for each(var presence in XMPP.cache.presenceOut)
                if(presence.session.name == account.jid) {
                    stanza = presence.stanza.copy();
                    if(message)
                        stanza.status = message;
                    else
                        delete stanza.status;
                    break;
                }

            if(!stanza) {
                if(message)
                    stanza = <presence><status>{message}</status></presence>;
                else
                    stanza = <presence/>;
            }

            XMPP.send(account, stanza);
        }
}

function openAttachPanel(account, address, resource, type, url, target, action) {
    var contentPanel;

    switch(target) {
    case 'browser-tab':
        if(!(url.match(/^javascript:/) ||
             getBrowser().contentDocument.location.href == 'about:blank')) {
            getBrowser().selectedTab = getBrowser().addTab();
        }

        contentPanel = getBrowser().selectedBrowser;
        break;

    case 'browser-current':
        contentPanel = getBrowser().selectedBrowser;
        break;

    case 'sidebar':
        var conversation = cloneBlueprint('conversation');
        _('conversations').appendChild(conversation);
        _(conversation, {role: 'contact'}).value = XMPP.nickFor(account, address);
        contentPanel = _(conversation, {role: 'chat'});
        conversation.setAttribute('account', account);
        conversation.setAttribute('address', address);
        conversation.setAttribute('resource', resource);
        conversation.setAttribute('type', type);
        conversation.setAttribute('url', url);

        contentPanel.addEventListener(
            'click', function(event) {
                clickedElementInConversation(event);
            }, true);

        break;
    
    default:
        throw new Error('Unexpected. (' + target + ')');
        break;
    }

    if(target != 'browser-current')
        contentPanel.contentDocument.location.href = url;


    if(!url || url.match(/^javascript:/)) {
        XMPP.enableContentDocument(contentPanel, account, address, type, true);

        if(action)
            action(contentPanel);
    } else
        queuePostLoadAction(
            contentPanel, function(document) {
                XMPP.enableContentDocument(contentPanel, account, address, type);

                if(url == getDefaultAppUrl())
                    openedConversation(account, address, type);

                if(action) 
                    action(contentPanel);
            });

    return contentPanel;
}

function focusConversation(account, address) {
    var conversation = getConversation(account, address);

    if(conversation) {
        _('conversations').selectedPanel = conversation;
        focusedConversation(account, address);
        _(conversation, {role: 'chat'}).contentWindow.focus();
        document.commandDispatcher.advanceFocus();
    }
}

function closeConversation(account, address) {
    var conversation = getConversation(account, address);

    if(conversation) {
        conversation.parentNode.removeChild(conversation);
        closedConversation(account, address);
    }
}

function promptOpenConversation(account, address, type, nick) {
    var request = {
        address: address,
        account: account,
        type: type,
        nick: nick,
        confirm: false
    }

    window.openDialog(
        'chrome://sameplace/content/open_conversation.xul',
        'sameplace-open-conversation', 'modal,centerscreen',
        request);   

    if(request.confirm)
        if(request.type == 'groupchat')
            joinRoom(request.account, request.address, request.nick);
        else           
            if(isConversationOpen(request.account, request.address))
                focusConversation(request.account, request.address);
            else
                withConversation(
                    request.account, request.address, null, 'chat', true, 
                    function() {
                        focusConversation(request.account, request.address);
                    });
}


// GUI REACTIONS
// ----------------------------------------------------------------------

var chatDropObserver = {
    getSupportedFlavours: function () {
        var flavours = new FlavourSet();
        flavours.appendFlavour('text/html');
        flavours.appendFlavour('text/unicode');
        return flavours;
    },

    onDrop: function(event, dropdata, session) {
        if(!dropdata.data)
            return;

        var document = event.currentTarget.contentDocument;
        var dropTarget = event.target;

        document.getElementById('dnd-sink').textContent = (
            <data content-type={dropdata.flavour.contentType}>
            {dropdata.data}
            </data>
            ).toXMLString();

        var synthEvent = document.createEvent('Event');
        synthEvent.initEvent('hsDrop', true, false);
        dropTarget.dispatchEvent(synthEvent);
    }
};

function requestedCommunicate(account, address, type, url, target) {
    if(url == getDefaultAppUrl()) {
        if(type == 'groupchat' && !isConversationOpen(account, address))        
            promptOpenConversation(account, address, type);
        else 
            withConversation(
                account, address, null, type, true, function() {
                    focusConversation(account, address);
                });
    } else
        openAttachPanel(account, address, null, type, url, target);
};

function clickedElementInConversation(event) {
    var ancestorAnchor = hasAncestor(event.target, 'a', ns_xhtml);
    if(ancestorAnchor) {
        var newTab;
        
        switch(event.button) {
        case 0: newTab = false; break;
        case 1: newTab = true;  break;
        }

        if(newTab != undefined) {
            openInBrowser(ancestorAnchor.getAttribute('href'), newTab);
            event.preventDefault();
        }
    }
}

function requestedChangeStatusMessage(event) {
    if(event.keyCode != KeyEvent.DOM_VK_RETURN)
        return;

    var message = event.target.value;
    if(message != '[no status message]')
        changeStatusMessage(event.target.value);
    
    document.commandDispatcher.advanceFocus();
}

function focusedConversation(account, address) {
    contacts.nowTalkingWith(account, address);
}

function requestedAddContact() {
    var request = {
        contactAddress: undefined,
        subscribeToPresence: undefined,
        confirm: false,
        account: undefined
    };

    window.openDialog(
        'chrome://sameplace/content/add_contact.xul',
        'sameplace-add-contact', 'modal,centerscreen',
        request);

    if(request.confirm)
        contacts.addContact(request.account, request.contactAddress, request.subscribeToPresence);
}

function requestedAttachBrowser(element) {
    openAttachPanel(attr(element, 'account'),
                    attr(element, 'address'),
                    attr(element, 'resource'),
                    attr(element, 'type'),
                    null, 'browser-current');
}

function requestedCloseConversation(element) {
    if(attr(element, 'type') == 'groupchat')
        exitRoom(attr(element, 'account'),
                 attr(element, 'address'),
                 attr(element, 'resource'));

    closeConversation(attr(element, 'account'),
                      attr(element, 'address'),
                      attr(element, 'resource'),
                      attr(element, 'type'));
}

function requestedOpenConversation() {
    promptOpenConversation();    
}

function openedConversation(account, address, type) {
    contacts.startedConversationWith(account, address, type);
    
    if(_('conversations').childNodes.length == 1)
        contacts.nowTalkingWith(account, address);
}

function closedConversation(account, address) {
    contacts.stoppedConversationWith(account, address);
    if(_('conversations').childNodes.length == 0)
        _('conversations').collapsed = true;
    else if(!_('conversations').selectedPanel) {
        _('conversations').selectedPanel = _('conversations').lastChild;
        focusedConversation(
            _('conversations').lastChild.getAttribute('account'),
            _('conversations').lastChild.getAttribute('address'));
    } else
        focusedConversation(
            _('conversations').selectedPanel.getAttribute('account'),
            _('conversations').selectedPanel.getAttribute('address'));
}


// NETWORK ACTIONS
// ----------------------------------------------------------------------
// Application-dependent functions dealing with the network.
//
// They SHOULD NOT fetch information from the interface, a separate
// function should instead be created that calls these ones and passes
// the gathered data via function parameters.

function exitRoom(account, roomAddress, roomNick) {
    XMPP.send(account,
              <presence to={roomAddress + '/' + roomNick} type="unavailable"/>);
}

function joinRoom(account, roomAddress, roomNick) {
    XMPP.send(account,
              <presence to={roomAddress + '/' + roomNick}>
              <x xmlns='http://jabber.org/protocol/muc'/>
              </presence>);
}


// NETWORK REACTIONS
// ----------------------------------------------------------------------

function seenChatMessage(message) {
    var contact = XMPP.JID(
        (message.stanza.@from != undefined ?
         message.stanza.@from : message.stanza.@to));

    var wConversation = getConversation(message.session.name, contact.address);
    if(!wConversation) {
        openAttachPanel(
            message.session.name, contact.address,
            contact.resource, message.stanza.@type,
            getDefaultAppUrl(),
            'sidebar',
            function(contentPanel) {
                contentPanel.xmppChannel.receive(message);
            });
        openedConversation(message.session.name, contact.address, message.stanza.@type);
    } else if(!wConversation.contentDocument ||
              (wConversation.contentDocument &&
               !wConversation.contentDocument.getElementById('xmpp-incoming'))) {

        queuePostLoadAction(
            _(wConversation, {role: 'chat'}), function(contentPanel) {
                contentPanel.xmppChannel.receive(message);
            });
    }

}

function sentAvailablePresence(presence) {
    _('status-message').value = presence.stanza.status.toString() || '[no status message]';
    _('status-message').setAttribute('draft', 'false');
}

function sentMUCPresence(presence) {
    var room = XMPP.JID(presence.stanza.@to);

    openAttachPanel(
        presence.session.name, room.address, room.resource, 'groupchat',
        getDefaultAppUrl(), 'sidebar',
        function(contentPanel) {
            focusConversation(presence.session.name, room.address);
        });
}


// DEVELOPER UTILITIES
// ----------------------------------------------------------------------

function getStackTrace() {
    var frame = Components.stack.caller;
    var str = "<top>";

    while (frame) {
        str += '\n' + frame;
        frame = frame.caller;
    }

    return str;
}

function log(msg) {
    Cc[ "@mozilla.org/consoleservice;1" ]
        .getService(Ci.nsIConsoleService)
        .logStringMessage(msg);
}

function hoveredMousePointer(event) {
    if(!event.target.hasAttribute)
        return;

    var get = (event.target.hasAttribute('account')) ?
        (function(attributeName) { return event.target.getAttribute(attributeName); }) :
        (function(attributeName) { return getAncestorAttribute(event.target, attributeName); });

    getTop().document.getElementById('statusbar-display').label =
        'Account: <' + get('account') + '>, ' +
        'Address: <' + get('address') + '>, ' +
        'Resource: <' + get('resource') + '>, ' +
        'Subscription: <' + get('subscription') + '>, ' +
        'Type: <' + get('type') + '>';
}

