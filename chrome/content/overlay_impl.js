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
const pref = Cc['@mozilla.org/preferences-service;1']
    .getService(Ci.nsIPrefService)
    .getBranch('extensions.sameplace.');

var ns_auth = 'jabber:iq:auth';


// GLOBAL STATE
// ----------------------------------------------------------------------

var channel;


// GUI UTILITIES (SPECIFIC)
// ----------------------------------------------------------------------

function _(id) {
    return document.getElementById('sameplace-' + id);
}


// INITIALIZATION
// ----------------------------------------------------------------------

function initOverlay(event) {
    channel = XMPP.createChannel();

    initNetworkReactions();
    initDisplayRules();
    initHotkeys();

    // Only preload SamePlace if there's no other window around with
    // an active SamePlace instance, and if this isn't a popup.'

    if(!isActiveSomewhere() && window.toolbar.visible)
        load();

    // Depending on entity of update, run wizard and/or show
    // changelog.

    upgradeCheck(
        'sameplace@hyperstruct.net',
        'extensions.sameplace.version', {
            onFirstInstall: function() {
                runWizard();
            }
        });    
}

function initNetworkReactions() {
    channel.on({
        event     : 'transport',
        direction : 'out',
        state     : 'start'
    }, function() {
        if(window == getMostRecentWindow() && window.toolbar.visible)
            load();
    });

    channel.on({
        event     : 'iq',
        direction : 'out',
        stanza    : function(s) { return s.ns_auth::query != undefined; }
    }, function() {
        if(window == getMostRecentWindow() && window.toolbar.visible) {
            viewFor('contacts').frameElement.collapsed = false;
            viewFor('toolbox').frameElement.collapsed = false;
        }
    });

    channel.on({
        event     : 'message',
        direction : 'in',
        stanza    : function(s) { return s.@type == 'chat' && s.body.text() != undefined; }
    }, function(message) {
        if(pref.getBoolPref('getAttentionOnMessage'))
            window.getAttention();
    });
}


function initDisplayRules() {

    // Adapt toolbox frame to toolbox content.  This is done once here
    // and once in toolbox.xul onload handler.  Doing it only here
    // doesn't work for default theme; doing it only there doesn't
    // work for iFox smooth theme (assuming the theme has anything to
    // do with this).  Go figure.
    
    frameFor('toolbox').addEventListener(
        'DOMAttrModified', function(event) {
            if(event.currentTarget == event.target &&
               event.attrName == 'collapsed')
                setTimeout(function(){ viewFor('toolbox').sizeToContent(); }, 0)
        }, false);

    // When user selects a contact, display conversation view (NOT
    // containing area).

    frameFor('contacts').addEventListener(
        'contact/select', function(event) {
            frameFor('conversations').collapsed = false;
            viewFor('conversations').focused();
        }, false);

    // When last conversation closes, hide conversation view (NOT
    // containing area).

    frameFor('conversations').addEventListener(
        'conversation/close', function(event) {
            if(viewFor('conversations').conversations.count == 1)
                frameFor('conversations').collapsed = true;
        }, false);

    // If XMPP button is visible, attach to it and use to toggle
    // whatever area contacts are displayed in.

    var button = document.getElementById('xmpp-button');
    if(button)
        button.addEventListener(
            'command', function(event) {
                if(event.target == button)
                    toggle();
            }, false);

    // When conversations are collapsed, hide corresponding splitter.
    // Also, if conversations are collapsed, user is no longer keeping
    // an eye on "current" conversation.  Inform the contacts
    // subsystem about this.

    frameFor('conversations').addEventListener(
        'DOMAttrModified', function(event) {
            if(event.attrName == 'collapsed' &&
               event.target == frameFor('conversations')) {
                var xulSplitter = event.target.previousSibling;
                xulSplitter.hidden = event.target.collapsed;

                viewFor('contacts').nowTalkingWith(null, null);
            }
        }, false);

    // Apply rules to areas
    
    var xulAreas = document.getElementsByAttribute('class', 'sameplace-area');
    
    for(var i=0; i<xulAreas.length; i++)
        xulAreas[i].addEventListener(
            'DOMAttrModified', function(event) {
                if(event.attrName == 'collapsed') {
                    if(event.target.getAttribute('class') == 'sameplace-area') {
                        // When area is collapsed, hide corresponding splitter.
                        var xulArea =
                            event.target;
                        var xulSplitter = document.getElementById(
                            xulArea.id.replace(/^sameplace-area/, 'sameplace-splitter'));
                        xulSplitter.hidden = (event.newValue.toString() == 'true');
                    } else if(event.target.nodeName == 'iframe') {
                        // When view is collapsed, possibly hide containing area too.
                        var xulArea =
                            event.currentTarget;
                        var xulContactsView =
                            xulArea.getElementsByAttribute('class', 'sameplace-contacts')[0];
                        var xulConversationsView =
                            xulArea.getElementsByAttribute('class', 'sameplace-conversations')[0];
                        xulArea.collapsed = 
                            (xulContactsView.collapsed && xulConversationsView.collapsed);
                    }
                }
            }, false);
}

function initHotkeys() {
    var toggleContactsKey = eval(pref.getCharPref('toggleContactsKey'))
    var toggleConversationsKey = eval(pref.getCharPref('toggleConversationsKey'))

    window.addEventListener(
        'keypress', function(event) {
            if(matchKeyEvent(event, toggleContactsKey))
                toggle();
            
            if(matchKeyEvent(event, toggleConversationsKey))
                frameFor('conversations').collapsed = !frameFor('conversations').collapsed;
        }, true)

    pref.QueryInterface(Ci.nsIPrefBranch2)
    pref.addObserver('', {
        observe: function(subject, topic, data) {
            if(topic == 'nsPref:changed') {
                switch(data) {
                case 'toggleContactsKey':
                    toggleContactsKey = eval(pref.getCharPref('toggleContactsKey'));
                    break;
                case 'toggleConversationsKey':
                    toggleConversationsKey = eval(pref.getCharPref('toggleConversationsKey'));
                    break;
                }
            }
        }
    }, false);
}


// GUI ACTIONS
// ----------------------------------------------------------------------

function toggle(event) {
    areaFor('contacts').collapsed = !areaFor('contacts').collapsed;
    if(!areaFor('contacts').collapsed) {
        frameFor('contacts').collapsed = false;
        frameFor('toolbox').collapsed = false;
    }
}

function runWizard() {
    window.openDialog(
        'chrome://sameplace/content/wizard.xul',
        'sameplace-wizard', 'chrome')
}

function load(force) {
    // XXX this does not handle "appcontent" setting as a conversation area

    if(force || viewFor('conversations').location.href != 'chrome://sameplace/content/sameplace.xul')
        viewFor('conversations').location.href = 'chrome://sameplace/content/sameplace.xul';
    if(force || viewFor('contacts').location.href != 'chrome://sameplace/content/contacts.xul') 
        viewFor('contacts').location.href = 'chrome://sameplace/content/contacts.xul';
    if(force || viewFor('toolbox').location.href != 'chrome://sameplace/content/toolbox.xul') 
        viewFor('toolbox').location.href = 'chrome://sameplace/content/toolbox.xul';
}


// GUI UTILITIES
// ----------------------------------------------------------------------

function isReceivingInput() {
    return (viewFor('conversations').isReceivingInput() ||
            (document.commandDispatcher.focusedElement &&
             document.commandDispatcher.focusedElement == viewFor('toolbox').document))
}

function areaFor(aspect) {
    switch(aspect) {
    case 'contacts':
    case 'toolbox':
        return _('area-' + pref.getCharPref('contactsArea'));
        break;
    case 'conversations':
        switch(pref.getCharPref('conversationsArea')) {
        case 'left':
        case 'right':
        case 'sidebar':
            return _('area-' + pref.getCharPref('conversationsArea'));
            break;
        case 'appcontent':
            return document.getElementById('appcontent');
            break;
        default:
            throw new Error('Invalid argument. (' + pref.getCharPref('conversationsArea') + ')');
        }
        break;
    default:
        throw new Error('Invalid argument. (' + aspect + ')');
    }
}

function frameFor(aspect) {
    if(['toolbox', 'contacts', 'conversations'].indexOf(aspect) == -1)
        throw new Error('Invalid argument. (' + aspect + ')');

    var xulArea = areaFor(aspect);
    if(xulArea.id == 'appcontent')
        return getBrowser().contentWindow;
    else
        return xulArea.getElementsByAttribute(
            'class', 'sameplace-' + aspect)[0];
}

function viewFor(aspect) {
    return frameFor(aspect).contentWindow;
}


// UTILITIES
// ----------------------------------------------------------------------

function matchKeyEvent(e1, e2) {
    return (e1.ctrlKey  == e2.ctrlKey &&
            e1.shiftKey == e2.shiftKey &&
            e1.altKey   == e2.altKey &&
            e1.metaKey  == e2.metaKey &&
            e1.charCode == e2.charCode &&
            e1.keyCode  == KeyEvent[e2.keyCodeName]);
}

function getMostRecentWindow() {
    return Cc['@mozilla.org/appshell/window-mediator;1']
        .getService(Ci.nsIWindowMediator)
        .getMostRecentWindow('');
}

function isActive() {
    return viewFor('contacts').document.location.href == 'chrome://sameplace/content/contacts.xul';
}

function isActiveSomewhere() {
    var windows = Cc['@mozilla.org/appshell/window-mediator;1']
        .getService(Ci.nsIWindowMediator)
        .getEnumerator('');

    while(windows.hasMoreElements()) {
        var window = windows.getNext();
        if(window.sameplace && window.sameplace.isActive())
            return true;
    }
    return false;
}

function upgradeCheck(id, versionPref, actions, ignoreTrailingParts) {
    const pref = Cc['@mozilla.org/preferences-service;1']
    .getService(Ci.nsIPrefService);

    function getExtensionVersion(id) {
        return Cc['@mozilla.org/extensions/manager;1']
        .getService(Ci.nsIExtensionManager)
        .getItemForID(id).version;
    }

    function compareVersions(a, b) {
        return Cc['@mozilla.org/xpcom/version-comparator;1']
        .getService(Ci.nsIVersionComparator)
        .compare(a, b);
    }

    var curVersion = getExtensionVersion(id);
    if(curVersion) {
        var prevVersion = pref.getCharPref(versionPref);
        if(prevVersion == '') {
            if(typeof(actions.onFirstInstall) == 'function')
                actions.onFirstInstall();
        } else {
            if(compareVersions(
                (ignoreTrailingParts ?
                 curVersion.split('.').slice(0, -ignoreTrailingParts).join('.') :
                 curVersion),
                prevVersion) > 0)
                if(typeof(actions.onUpgrade) == 'function')
                    actions.onUpgrade();
        }

        pref.setCharPref(versionPref, curVersion);
    }
}
