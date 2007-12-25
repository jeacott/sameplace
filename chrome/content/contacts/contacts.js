/*
 * Copyright 2006-2007 by Massimiliano Mirra
 * 
 * This file is part of SamePlace.
 * 
 * SamePlace is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 3 of the License, or (at your
 * option) any later version.
 * 
 * SamePlace is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * 
 * Author: Massimiliano Mirra, <bard [at] hyperstruct [dot] net>
 *  
 */

// DOCUMENTATION
// ----------------------------------------------------------------------

// Individual DOM elements are retrieved with the $() function.  It
// accepts a CSS or XPath query.  It returns the DOM element.
// 
// Collections of DOM elements are retrieved with the $$() function.  It
// accepts a CSS or XPath query.  It returns an object with only a
// forEach() method.
// 
// Code is arranged in actions, reactions, and utilities.  Actions and
// reactions are allowed to access the environment (DOM and global
// variables).  Actions are allowed to cause side effects.  Utilities
// should neither rely on data other than what is provided via arguments,
// nor produce side effects.  This is a relaxed restriction, though.


// TODO
// ----------------------------------------------------------------------

// Replace "contact name" with "contact handle"
//
// Only blink message indicator if status is "available"
//
// On certain events, change contact background to get attention
//
// On upper right of contact, display capabilities and info like web
// page, mail, etc
//
// Per-contact menu to access shared apps


// DEFINITIONS
// ----------------------------------------------------------------------

var Cc = Components.classes;
var Ci = Components.interfaces;
var srvPrompt = Cc["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Ci.nsIPromptService);

var COMPACT_WIDTH = 60;


// STATE
// ----------------------------------------------------------------------

var channel;
var simulation = false;
var insertionStrategy;


// INITIALIZATION/FINALIZATION
// ----------------------------------------------------------------------

function init(event) {
    initGUIReactions();
    initNetworkReactions();
    initState();
}

function initGUIReactions() {
    // Cannot be assigned via onscroll="..." because scroll event in
    // Firefox2 is not reflected onto attribute.
    $('#contacts').addEventListener('scroll', scrolledContacts, false);

    window.addEventListener('resize', resizedView, false);
}

function initNetworkReactions() {
    channel = XMPP.createChannel();

    channel.on({
        event     : 'iq',
        direction : 'in',
        stanza    : function(s) {
            return s.ns_roster::query != undefined;
        }
    }, receivedRoster);

    channel.on({
        event     : 'presence',
        direction : 'in',
        stanza    : function(s) {
            return s.@type == undefined || s.@type == 'unavailable'
        }
    }, receivedPresence);
}

function initState() {
    resizedView()
    regenerateGroups();

    insertionStrategy = insertionStrategies[
        $('#contacts').getAttribute('sort')];
    
    if(simulation) {
        populateListFake();
    } else {
        XMPP.accounts
            .filter(XMPP.isUp)
            .forEach(requestRoster);
        
        XMPP.cache
            .all(XMPP.q()
                 .event('presence')
                 .direction('in'))
            .forEach(receivedPresence);
    }
}

function finish() {
    channel.release();
}


// GUI ACTIONS
// ----------------------------------------------------------------------

function setInsertionStrategy(strategyName) {
    var xulContacts = $('#contacts');
    var currentStrategyName = xulContacts.getAttribute('sort');
    if(strategyName != currentStrategyName) {
        xulContacts.setAttribute('sort', strategyName);
        insertionStrategy = insertionStrategies[strategyName];
        for each(var xulContact in Array.slice(xulContacts.childNodes)) {
            placeContact(xulContact);
        }
    }
}

function openURL(url) {
    if(typeof(getBrowser) == 'function' &&
       'addTab' in getBrowser() &&
       url.match(/^((https?|ftp|file):\/\/|(xmpp|mailto):)/))
        getBrowser().selectedTab = getBrowser().addTab(url);
    else
        Cc['@mozilla.org/uriloader/external-protocol-service;1']
        .getService(Ci.nsIExternalProtocolService)
        .loadUrl(Cc['@mozilla.org/network/io-service;1']
                 .getService(Ci.nsIIOService)
                 .newURI(url, null, null));
}

function toggleOfflineContacts() {
    toggleClass($('#contacts'), 'hide-unavailable');
    contactsUpdated();
}

function updateContactPhoto(account, address, xmlPhoto) {
    var xulContact = getContact(account, address);
    
    if(xmlPhoto.ns_vcard::BINVAL != undefined)
        $(xulContact, '.avatar').setAttribute(
            'src', 'data:' + xmlPhoto.ns_vcard::TYPE + ';base64,' +
                xmlPhoto.ns_vcard::BINVAL);
    else if(xmlPhoto.ns_vcard::EXTVAL != undefined)
        $(xulContact, '.avatar').setAttribute(
            'src', xmlPhoto.ns_vcard::EXTVAL);
}

function placeContact(xulContact) {
    var xulContacts = $('#contacts');
    var insertionPoint = findInsertionPoint(
        xulContacts.childNodes,
        insertionStrategy(
            xulContact.getAttribute(xulContacts.getAttribute('sort'))));

    if(insertionPoint)
        xulContacts.insertBefore(xulContact, insertionPoint);
    else
        xulContacts.appendChild(xulContact);

    contactsUpdated();
}

function regenerateGroups() { // these won't take into account non-ascii characters
    var ASCIICODE_A = 65, ASCIICODE_Z = 91;

    var xulContacts = $('#contacts');
    $$(xulContacts, '.header').forEach(function(xulHeader) {
        xulContacts.removeChild(xulHeader);
    });

    var xulBlueprint = $('#blueprints > .header');
    var xulHeader, letter;

    for(var i=ASCIICODE_A; i<ASCIICODE_Z; i++) {
        letter = String.fromCharCode(i);
        xulHeader = xulBlueprint.cloneNode(true);
        xulHeader.setAttribute('display-name', letter.toLowerCase());
        $(xulHeader, '> .title').setAttribute('value', letter);
        xulContacts.appendChild(xulHeader);
    }
}

function incPending(address) {
    var xulContact = $('#contacts > .contact[address="' + address + '"]');
    var pending = parseInt(xulContact.getAttribute('pending'));
    xulContact.setAttribute('pending', pending+1);
}

function toggleToolbar() {
    toggle($('#old-controls'), 'height', $('#old-controls').originalHeight, function() {
        if($('#old-controls').height != 0)
            $('#filter').focus();
    });
}

function toggleConversations() {
    $('#conversations').collapsed = !$('#conversations').collapsed;
}

function createContact(account, address) {
    var xulContact = xulContact = $('#blueprints > .contact').cloneNode(true);
    xulContact.setAttribute('account', account);
    xulContact.setAttribute('address', address);
    return xulContact;
}

function getContact(account, address) {
    return $('.contact[account="' + account + '"][address="' + address + '"]');
}

function updateHeaders() {
    var xulContacts = $('#contacts');

    var xulAllHeaders = $$(xulContacts, '.header');

    // XXX following CSS query doesn't work yet as css->xpath
    // translator doesn't generate [1] at the end:
    // $$('#contacts .contact - .header')

    // for every contact, take the first preceding sibling of class
    // "header". this excludes headers with no contact followers
    // before the next header.

    var xulHeadersWithContacts =
        $$('//*[@id = "contacts"]' +
           '//*[contains(@class, "contact") ' +
           (hasClass(xulContacts, 'hide-unavailable') ?
            'and @availability = "available"]' : ']') +
           '/preceding-sibling::*[contains(@class, "header")][1]')
        .toArray();

    // Sort-of parallel iteration on all headers and active headers.
    // Iteration on active headers is done destructively by shift()ing
    // one element every time one is found in the list of all headers.
    // (This only works because we can count on the lists being
    // ordered the same way.)

    xulAllHeaders.forEach(function(xulHeader) {
        if(xulHeader == xulHeadersWithContacts[0]) {
            addClass(xulHeader, 'active');
            xulHeadersWithContacts.shift();
        } else {
            removeClass(xulHeader, 'active');
        }
    });
}

function requestedFilter(namePart) {
    filterContacts(namePart);
}

function filterContacts(prefix) {
    $('#contacts').scrollBoxObject.scrollTo(0,0);

    const EMPTY = /^\s*$/

    // XXX this can be optimized by keeping every result set
    // around...
    
    var oldCandidates =
        '//*[@id = "contacts"]/*[contains(@class, "contact")' +
        ' and @candidate = "true"]';

    $$(oldCandidates).forEach(function(xulContact) {
        xulContact.removeAttribute('candidate');
    });
    
    if(prefix.match(EMPTY)) {
        $('#contacts').removeAttribute('filtering');
    } else {
        $('#contacts').setAttribute('filtering', 'true');

        var newCandidates =
            '//*[@id = "contacts"]/*[contains(@class, "contact")' +
            ' and contains(@display-name, "' + prefix.toLowerCase() + '")]';
    
        $$(newCandidates).forEach(function(xulContact) {
            xulContact.setAttribute('candidate', 'true');
        });
    }
}


// GUI REACTIONS
// ----------------------------------------------------------------------

function showingPeopleMenu(event) {
    var xulPopup = event.target;
    var insertionStrategyName = $('#contacts').getAttribute('sort');
    $(xulPopup, '[value="' + insertionStrategyName + '"]')
        .setAttribute('checked', 'true');
}

function clickedStatus(event) {
    var url = event.target.getAttribute('link');
    if(url)
        openURL(url);
}

function contactsUpdated() {
    singleExec(updateHeaders);
}

function resizedView(event) {
    setClass($('#view'), 'compact', document.width == COMPACT_WIDTH);
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
        addContact(request.account,
                   request.contactAddress,
                   request.subscribeToPresence);
}

function requestedConnection() {
    if(XMPP.accounts.length > 0)
        XMPP.up();
    else
        runWizard(); // XXX not ported
}

function requestedSetContactAlias(element) {
    var xulContact = (element.getAttribute('class') == 'contact' ?
                      element :
                      $(element, '^ .contact'));

    var account = xulContact.getAttribute('account');
    var address = xulContact.getAttribute('address');
    var alias = { value: XMPP.nickFor(account, address) };

    var confirm = srvPrompt.prompt(
        null,
        $('#strings').getString('aliasChangeTitle'),
        $('#strings').getFormattedString('aliasChangeMessage', [address]),
        alias, null, {});

    if(confirm)
        XMPP.send(account,
                  <iq type="set"><query xmlns="jabber:iq:roster">
                  <item jid={address} name={alias.value}/>
                  </query></iq>);
}

function clickedContactName(event) {
    if(event.button == 0)
        toggle($(event.target, '^ .contact .extra'), 'height', 100);
}

function onContactDragEnter(event) {
    event.currentTarget.setAttribute('dragover', 'true');    
}

function onContactDragExit(event) {
    event.currentTarget.removeAttribute('dragover');    
}

function scrolledContacts(event) {
    scroller.update();
}

function changedContactsOverflow(event) {
    scroller.update();
}


// UTILITIES
// ----------------------------------------------------------------------

function getBrowser() {
    return top.getBrowser();
}

function timedExec(actionGenerator, interval) {
    var interval = window.setInterval(function(){
        try {
            actionGenerator.next().call();
        } catch(e if e == StopIteration) {
            window.clearInterval(interval);
        } catch(e) {
            window.clearInterval(interval);
            throw e;
        }
    }, interval);
}

function timedForEach(list, action, interval) {
    var i=0;
    var intervalId = window.setInterval(function() {
        try {
            if(list[i])
                action(list[i++]);
            else
                window.clearInterval(intervalId);

        } catch(e) {
            Components.utils.reportError(e);
            window.clearInterval(intervalId);
        }
    }, interval);
}

function asDOM(object) {
    var parser = Cc['@mozilla.org/xmlextras/domparser;1']
        .getService(Ci.nsIDOMParser);

    asDOM = function(object) {
        if(object instanceof Ci.nsIDOMElement)
            return object;

        var element;
        switch(typeof(object)) {
        case 'xml':
            element = parser
                .parseFromString(object.toXMLString(), 'text/xml')
                .documentElement;
            break;
        case 'string':
            element = parser
                .parseFromString(object, 'text/xml')
                .documentElement;
            break;
        default:
            throw new Error('Argument error. (' + typeof(object) + ')');
        }
        
        return element;
    };

    return asDOM(object);
}

function findInsertionPoint(xulNodeList, criteriaFunc) {
    if(xulNodeList.length == 0)
        return null;

    for(var i=0, l=xulNodeList.length-1; i<l; i++) {
        var left = xulNodeList[i], right = xulNodeList[i+1];
        switch(criteriaFunc(left, right)) {
        case 0:
            return right;
            break;
        case 1:
            if(i == l-2)
                return null;
            break;
        case -1:
            if(i == 0)
                return left;
            break;
        default:
            throw new Error('Unhandled result. (' +
                            criteriaFunc(left, right) +
                            ')');
        }
    }
}

var insertionStrategies = {};

insertionStrategies['activity'] = function(activity) {
    return function(xulContact1, xulContact2) {
        if(activity < xulContact1.getAttribute('activity'))
            return 1;
        else if(activity > xulContact2.getAttribute('activity'))
            return -1;
        else
            return 0;
    }
}

insertionStrategies['display-name'] = function(name) {
    return function(xulContact1, xulContact2) {
        if(name < xulContact1.getAttribute('display-name'))
            return -1;
        else if(name > xulContact2.getAttribute('display-name'))
            return 1;
        else
            return 0;
    }
}

function setClass(xulElement, aClass, state) {
    if(state)
        addClass(xulElement, aClass);
    else
        removeClass(xulElement, aClass);
}

function toggleClass(xulElement, aClass) {
    if(hasClass(xulElement, aClass))
        removeClass(xulElement, aClass);
    else
        addClass(xulElement, aClass);
}

function hasClass(xulElement, aClass) {
    return xulElement.getAttribute('class').split(/\s+/).indexOf(aClass) != -1;
}

function addClass(xulElement, newClass) {
    var classes = xulElement.getAttribute('class').split(/\s+/);
    if(classes.indexOf(newClass) == -1)
        xulElement.setAttribute('class', classes.concat(newClass).join(' '));
}

function removeClass(xulElement, oldClass) {
    var classes = xulElement.getAttribute('class').split(/\s+/);
    var oldClassIndex = classes.indexOf(oldClass);
    if(oldClassIndex != -1) {
        classes.splice(oldClassIndex, 1);
        xulElement.setAttribute('class', classes.join(' '));
    }
}

function toggle(object, property, limit, afterAction) {
    if(object[property] == 0)
        animate(object, property, 6, limit, afterAction);
    else
        animate(object, property, 6, 0, afterAction);
}

function animate(object, property, steps, target, action) {
    if(object.__animating)
        return;
    object.__animating = true;

    var increment = (target - object[property])/steps;

    function step() {
        var currentValue = parseInt(object[property]);
        if(Math.abs(increment) >= Math.abs(currentValue - target)) {
            object[property] = target;
            if(typeof(action) == 'function')
                action();
            delete object.__animating;
        } else {
            object[property] = currentValue + increment;
            window.setTimeout(function() { step(); }, 30);
        }
    }

    step();
}


// NETWORK ACTIONS
// ----------------------------------------------------------------------

function requestRoster(account) {
    XMPP.send(account,
              <iq type='get'>
              <query xmlns={ns_roster}/>
              <cache-control xmlns={ns_x4m_in}/>
              </iq>);
}

function requestVCard(account, address, action) {
    XMPP.send(account, 
              <iq to={address} type='get'>
              <vCard xmlns='vcard-temp'/>
              <cache-control xmlns={ns_x4m_in}/>
              </iq>,
              action);
}

function addContact(account, address, subscribe) {
    XMPP.send(account,
              <iq type='set'>
              <query xmlns='jabber:iq:roster'>
              <item jid={address}/>
              </query></iq>);

    if(subscribe)
        XMPP.send(account, <presence to={address} type="subscribe"/>);
}


// NETWORK REACTIONS
// ----------------------------------------------------------------------

function receivedRoster(iq) {
    for each(var item in iq.stanza..ns_roster::item) {
        contactChangedRelationship(
            iq.account,
            item.@jid,
            item.@subscription,
                item.@name);
    }
    contactsUpdated();

/*
    var makeUpdateActions = function() {
        for each(var item in iq.stanza..ns_roster::item) {
            yield function() { updateContact(iq.account, item.@jid); }
        }
    }

    if(!simulation)
        timedExec(makeUpdateActions(), 500);
*/


}

function receivedPresence(presence) {
    var account = presence.account;
    var address = XMPP.JID(presence.stanza.@from).address;
    var xulContact = getContact(account, address);
    if(!xulContact) // contact not in roster
        return;

//    var summary = XMPP.presenceSummary(account, address);

    var availability = presence.stanza.@type.toString() || 'available';
    var show = presence.stanza.show.toString();
    var status = presence.stanza.status.text();

    if(xulContact.getAttribute('status') == status &&
       xulContact.getAttribute('show') == show &&
       xulContact.getAttribute('availability') == availability)
        // Guard against mere re-assertions of status.  Google sends
        // this them out a lot...
        return;

    xulContact.setAttribute('availability', availability);
    xulContact.setAttribute('show', show);
    xulContact.setAttribute('status', status);
    xulContact.setAttribute('activity', (new Date()).getTime());    

    var ns_xul = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
    var xmlStatus = presence.stanza.status.text();
    var xulStatus =
        document.importNode(
            asDOM(filter.applyTextProcessors(
                    <description flex="1" xmlns={ns_xul}>{xmlStatus}</description>,
                [processURLs])),
            true);

    $(xulContact, '.status').replaceChild(
        xulStatus,
        $(xulContact, '.status').firstChild);

    if(presence.stanza.@type == 'unavailable')
        xulContact.setAttribute('chatstate', '');

    placeContact(xulContact);

    var photoHash = presence.stanza
        .ns_vcard_update::x
        .ns_vcard_update::photo
        .text();

    if(photoHash != undefined &&
       photoHash != $(xulContact, '.avatar').getAttribute('photo-hash')) {
        // XXX presently will always fetch from cache
        $(xulContact, '.avatar').setAttribute('photo-hash', photoHash);
        requestVCard(account, address, function(iq) {
            updateContactPhoto(account, address, iq.stanza..ns_vcard::PHOTO);
        });
    }
}

function receivedVCard(iq) {
    var photo = iq.stanza..ns_vcard::PHOTO;
    if(photo == undefined)
        return;

    var xulContact = getContact(iq.account, XMPP.JID(iq.stanza.@from).address);
    var data = 'data:' + photo.ns_vcard::TYPE + ';base64,' +
        photo.ns_vcard::BINVAL; //XXX support extval
    $(xulContact, '.avatar').setAttribute('src', data);

}

function contactChangedRelationship(account, address, subscription, name) {
    var xulContact = getContact(account, address) || createContact(account, address);

    if(subscription == 'remove') {
        $('#contacts').removeChild(xulContact);
        return;
    } else {
        xulContact.setAttribute('subscription', subscription);
    }

    var displayName = (name != undefined && name != '') ?
        name : (XMPP.JID(address).username || address);

    $(xulContact, '.name').setAttribute('value', displayName);
    $(xulContact, '.small-name').setAttribute('value', displayName);
    xulContact.setAttribute('display-name', displayName.toLowerCase());

    placeContact(xulContact);
}


// DEVELOPER UTILITIES
// ----------------------------------------------------------------------

function populateListFake() {
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'mary@gmail.com', 'both', 'Mary');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'patrick@sameplace.cc', 'both', 'Patrick');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'dana@sameplace.cc', 'both', '');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'sam@sameplace.cc', 'both', 'Sam');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'james@sameplace.cc', 'both', 'James');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'wally@gmail.com', 'both', 'Wally');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'benjamin@jabber.org', 'both', 'Benjaminus');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'jenny@sameplace.cc', 'both', 'Jenny');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'daniel@gmail.com', 'both', 'Daniel');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'sara@sameplace.cc', 'both', 'Sara');
    contactChangedRelationship(
        'bard@sameplace.cc/SamePlace', 'betty@sameplace.cc', 'both', 'Betty');

    setTimeout(function(){
    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='betty@sameplace.cc/SamePlace'>
            <show>away</show>
            <status>yawn</status>
            </presence>
    });
    },3000)

    setTimeout(function(){
    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='mary@gmail.com/SamePlace'>
            <status>teaching my cat to program in javascript and xul.  this is taking way less than it took to teach my boyfriend!</status>
            </presence>
    });
    },5000)

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='mary@gmail.com/SamePlace'>
            <status>teaching my cat to program in javascript and xul.  this is taking way less than it took to teach my boyfriend!</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='patrick@sameplace.cc/SamePlace'>
            <show>dnd</show>
            <status>Available</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='dana@sameplace.cc/SamePlace'>
            <status>in a meeting</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from="james@sameplace.cc/SamePlace">
            <status>taking photos</status>
            <show>away</show>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from="wally@gmail.com/SamePlace">
            <status>Zzzzz...</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from="benjamin@jabber.org/SamePlace">
            <status>Uhm...</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='jenny@sameplace.cc/SamePlace'>
            <status>listening to ella fitzgerald</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='daniel@gmail.com./SamePlace'>
            <status>coding, coding, coding...</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='sara@sameplace.cc/SamePlace'>
            <status>chilling</status>
            </presence>
    });

    receivedPresence({
        event: 'presence',
        account: 'bard@sameplace.cc/SamePlace',
        direction: 'in',
        stanza: <presence from='sam@sameplace.cc/SamePlace'>
            <status>omg! is this real? http://youtube.com/watch?v=4CpmCbBquUI</status>
            </presence>
    });

    window.setTimeout(function() {
        $('.control.offline-notice').hidden = true;
    }, 1000);
}





// Ensures that "action" is executed just once within a certain "wait"
// period (0.5s if not given), even if more calls to the same action
// are done in rapid succession.  Actions are compared by reference,
// so ideally they should be named functions in the top level.  (Two
// anonymous functions will be different objects even if they contain
// the same code.)

function singleExec(action, wait) {

    // Checker wakes up every tenth of a second and sees if any
    // action's waiting period has expired.  (This means that real
    // wait period for an action ranges between wait and wait+0.1s).
    //
    // Checker will happily keep track of multiple actions, but if
    // many actions are going to be executed in the same go, and first
    // one throws an error, subsequent ones won't be executed.

    function startChecker() {
        var interval = window.setInterval(function() {
            try {
                var now = new Date();
                pending = pending.filter(function(action) {
                    if(now - action.__last_invocation < action.__expire)
                        return true;
                    else {
                        action.call();
                        return false;
                    }
                });

                if(pending.length == 0)
                    window.clearInterval(interval);
            } catch(e) {
                window.clearInterval(interval);
                throw e;
            }
        }, 250);
    }

    // Redefine function on the fly, to carry some state but keep it
    // hidden from external context.

    var pending = [];
    singleExec = function(action, wait) {
        wait = wait || 200;
        action.__last_invocation = new Date();
        action.__expire = wait;

        if(pending.length == 0)
            startChecker();
            
        var pos = pending.indexOf(action);
        if(pos == -1)
            pending.push(action)
        else
            pending[pos] = action;
    };

    singleExec(action, wait);
}

function processURLs(xmlMessageBody) {
    var regexp = /(https?:\/\/|xmpp:|www\.)[^ \t\n\f\r"<>|()]*[^ \t\n\f\r"<>|,.!?(){}]/g;

    return xml.mapTextNodes(xmlMessageBody, function(textNode) {
        return text.mapMatch(
            textNode.toString(), regexp, function(url, protocol) {
                switch(protocol) {
                case 'http://':
                case 'https://':
                case 'xmpp:':
                    return <label crop="end" class="text-link" link={url} value={url}/>
                    break;
                default:
                    return <label crop="end" class="text-link" link={'http://' + url} value={url}/>
                }
            });
    });
}
