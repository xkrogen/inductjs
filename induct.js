/* Custom JS Rendering
 *
 * The purpose of this library is to provide incremental, and thus fast, updating of dynamic displayed content.
 *
 * You can view usage and implementation details at ***
 */

// TODO add link to the blog post above!!

/* List of HTML tag types you can specify that a template site should be wrapped in */
var allowedHtmlTags = ['div', 'span', 'ul', 'ol', 'p', 'table', 'tr', 'td', 'li',
    'a', 'b', 'blockquote', 'button', 'code', 'em', 'form', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'img', 'pre', 'strong', 'th'];
var rParse = new RegExp('\\{(' + allowedHtmlTags.join('|') + ')?\\{(if|text|for\\(([a-zA-Z]+)\\)|\\/if|\\/for)?(.*?)}}', 'g');

/* Parameters for list-matching optimizations */
var LIST_MATCH_TRAVERSE_FRACTION = 0.5, /* Fraction of the list to traverse looking for matches */
    LIST_MATCH_MAX_CHECK = 50,          /* Max number of items of the list to traverse */
    LIST_MATCH_SEQUENTIAL_LENGTH = 4;   /* Number of items in a row to be equal to consider it a match */

/* Call on a template to render it. This will automatically render or rerender the template as necessary.
 * If you pass in an uninstantiated template (never previously rendered), you MUST specify an insertPt (a DOM element
 * at which to insert the template). You can do this multiple times at different insertPts. If you pass in an instantiated
 * template, the insertPt argument will be ignored. Always returns the instantiated template, which you should keep to
 * pass in to subsequent calls to render.
 * TEMPLATE: The template to be rendered. Can be as-of-yet unrendered (i.e. returned from compile()) or rendered
 *           (i.e. returned from a previous call to render()). Unrendered templates will not be modified (you must
 *           store the return from render) but rendered templates will be modified in place.
 * CTX: The context to be used when rendering. Should be an object, whose fields you can access from within
 *      your template's markup by calling context.field.
 * INSERTPT: A reference to the DOM node at which to insert your template. You MUST specify this when passing in
 *           an unrendered template, and will be ignored if you pass in a previously rendered template.
 * RETURNS a rendered template.
 */
function render(template, ctx, insertPt) {
    if (!template || !(template instanceof Template)) {
        console.log("ERROR: Must pass in a valid template.");
        return;
    }
    if (template.inst) {
        return incrementalRerender(template, ctx);
    } else {
        if (!insertPt) {
            console.log("ERROR: Must specify an insertion point for unrendered templates.");
            return;
        }
        var renderWrapper = htmlRender(template, ctx);
        insertPt.innerHTML = renderWrapper.text;
        return renderWrapper.instTmpl;
    }
}

// TODO ERIK make render() accept an uncompiled string

/* A template object. */
function Template(type, expr, htmlTagType, tmplList, id) {
    /* ID of the HTML node enclosing this template site */
    this.id = id;
    /* Actual reference to the HTML node enclosing this template site */
    this.noderef = undefined;
    /* Expression to be evaluated for this template */
    this.expr = expr;
    /* Type of template - 'string' / 'if' / 'for' / 'html' / 'text' / 'root' */
    this.type = type;
    /* Specifies the type of html tag that should be used to enclose this. Defaults to span */
    this.htmlTagType = (htmlTagType === undefined || allowedHtmlTags.indexOf(htmlTagType) < 0)
                       ? 'span' : htmlTagType;
    /* Whether or not this is an INSTANTIATED template */
    this.inst = false;
    /* Maintains the previous value of evaluating expression */
    this.currentVal = undefined;
    /* List of instantiated templates making up the contents (used in if, for, root templates) */
    this.instTmplList = [];
    /* List of (non-instantiated) subtemplates contained within */
    this.tmplList = tmplList === undefined ? [] : tmplList;
    /* For-template specific items below */
    /* Stores the name of the variable which will be filled with the array values */
    this.forvar = undefined;
    /* Stores the type of HTML node which will be repeated for each element of the array */
    this.forNodeType = undefined;
    /* Stores the DOM element which encases each of the elements of the array
     * (one-to-one mapping with instTmplList) */
    this.forDomElements = undefined;
    /* Stores the id of the DOM element which encases each of the elements
     * of the array (one-to-one mapping with instTmplList) */
    this.forDomIds = [];
    /* Mapping from array element hashes to their current position in the list */
    this.forMap = {};
    /* Reference to HTML node for the starting comment node */
    this.commentstartnoderef = undefined;
    /* reference to HTML node for the ending comment node */
    this.commentendnoderef = undefined;
    /* Boolean value for whether or not the comment nodes have been inserted into the DOM yet */
    this.hasCommentNodes = undefined;
}

// consider subclassing out the list optimizations with a visitor type pattern, then you can see the high level algorithm more easily

Template.prototype = {
    constructor: Template,
    /* Instantiate this template using the provided values.
     * ID: The id to use for this template within the DOM.
     * CURRENTVAL: The value of the expression which will be displayed for this template.
     * INSTTEMPLIST: List of instantiated templates to be contained with.
     *               Only used for if- and for-templates.
     * FORDOMIDS: Array of IDs used for the iterated templates contained within (for-templates)
     * FORMAP: Map of keys for the iterated templates contained within to their positions (for-templates)
     * HASCOMMENTNODES: Denotes whether or not the comment nodes have been inserted to the DOM (for-templates)
     * RETURNS the new instantiated template.
     */
    instantiate: function (id, currentVal, instTempList, forDomIds, forMap, hasCommentNodes) {
        var newTemplate = new Template(this.type, this.expr, this.htmlTagType, this.tmplList, id);
        newTemplate.inst = true;
        if (instTempList !== undefined)
            newTemplate.instTmplList = instTempList;
        if (this.type === 'for') {
            newTemplate.forvar = this.forvar;
            newTemplate.forNodeType = this.forNodeType;
            newTemplate.forDomIds = forDomIds;
            newTemplate.forDomElements = [];
            newTemplate.forMap = forMap;
            newTemplate.hasCommentNodes = hasCommentNodes;
        }
        newTemplate.currentVal = currentVal;
        return newTemplate;
    },
    /* Return a reference to this template's DOM node. */
    getnoderef: function() {
        if (this.noderef === undefined) {
            if (this.type === 'for') {
                this.noderef = this.getcommentstartnoderef().parentNode; // find the comment node, enclosing node is parent
            } else {
                this.noderef = document.getElementById(this.id);
            }
        }
        return this.noderef;
    },
    /* (For-templates only)
     * Inserts the comment nodes which will be used to track this for-template into the DOM.
     */
    insertCommentNodes: function() {
        if (this.type !== 'for') { return; }
        var firstChild = this.getfornoderef(0), lastChild = this.getfornoderef(this.forDomIds.length-1);
        var commentStartNode, commentEndNode;
        commentStartNode = document.createComment('for-loop-start-' + this.id);
        commentEndNode = document.createComment('for-loop-end-' + this.id);
        firstChild.parentNode.insertBefore(commentStartNode, firstChild);
        lastChild.parentNode.insertBefore(commentEndNode, lastChild.nextSibling);
        this.commentstartnoderef = commentStartNode;
        this.commentendnoderef = commentEndNode;
        this.hasCommentNodes = true;
    },
    /* (For-templates only)
     * Populates this template's comment node reference fields.
     */
    findCommentNodes: function() {
        if (this.type !== 'for') { return; }
        if (this.hasCommentNodes) {
            var treeWalker, self = this;
            function filter(node) {
                if (node.nodeValue === ('for-loop-start-' + self.id)) {
                    self.commentstartnoderef = node;
                    return NodeFilter.FILTER_ACCEPT;
                } else if (node.nodeValue === ('for-loop-end-' + self.id)) {
                    self.commentendnoderef = node;
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
            /* IE and other browsers differ in how the filter method is passed into the
             * TreeWalker. Mozilla takes an object with an "acceptNode" key. IE takes the
             * filter method directly. To work around this difference, we will define the
             * acceptNode function a property of itself. */
            filter.acceptNode = filter;
            treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, filter, false);
            treeWalker.nextNode();
            treeWalker.nextNode();
        } else {
            this.insertCommentNodes();
        }
    },
    /* (For-templates only)
     * RETURNS a reference to the comment node at the start of the list.
     */
    getcommentstartnoderef: function() {
        if (this.commentstartnoderef === undefined)
            this.findCommentNodes();
        return this.commentstartnoderef;
    },
    /* (For-templates only)
     * RETURNS a reference to the comment node at the end of the list.
     */
    getcommentendnoderef: function() {
    if (this.commentendnoderef === undefined)
        this.findCommentNodes();
    return this.commentendnoderef;
    },
    /* (For-templates only)
     * RETURNS a reference to the for-node at the specific position in the list.
     */
    getfornoderef: function(position) {
        if (this.forDomElements[position] === undefined)
            this.forDomElements[position] = document.getElementById(this.forDomIds[position]);
        return this.forDomElements[position];
    }
};

/* General helper functions */

/* RETURNS a new unique ID. */
var getNextID = (function() {
    var idCount = 0;
    return function() {
        return 'templateID' + idCount++;
    }
})();

/* Wraps a string within an html tag with a new unique ID.
 * STR: The HTML string to be wrapped.
 * HTMLTAG: What type of tag/element to wrap it within.
 * RETURNS an object with field id containing the new unique id,
 *         field text containing wrapped text
 */
function wrapWithID(str, htmlTag) {
    var newID = getNextID();
    return {id: newID, text: '<' + htmlTag + ' id="' + newID + '">' + str + '</' + htmlTag + '>'};
}

/* Evaluate a function within a certain context.
 * EVALFUNC: Function to be evaluated.
 * CONTEXT: Context to evaluate within.
 * RETURNS the return value of that function within that context.
 */
function evalInContext(evalFunc, context) {
    return evalFunc.call(context);
}

/* Creates a document fragment from an HTML string.
 * STRING: HTML string to use
 * RETURNS document fragment object
 */
function documentFragFromHTML(string) {
    var temp = document.createElement('template');
    temp.innerHTML = string;
    return temp.content;
}

/* Creates a function from a Javascript expression.
 * STR: Javascript expression
 * RETURNS a new function
 */
function fnFromString(str) {
    return new Function('var context = this; return ' + str + ';');
}

/* Helper function for incrementalRerender. Iterates through the
 * templates nested within TMPL and renders them using the
 * provided context CTX.
 */
function iterateThroughNestedTmpls(tmpl, ctx) {
    tmpl.instTmplList = tmpl.instTmplList.map(function (innerTmpl) {
        return incrementalRerender(innerTmpl, ctx);
    });
}

/* Attempt to perform a incremental rerender, only changing those parts of the
 * page which have modified content.
 * TEMPLATE: The template to render. Must be an instantiated template.
 * CTX: Context to evaluate within.
 * RETURNS the new instantiated template, which may be the same as the old
 *         object, or may be a new object.
 */
function incrementalRerender(template, ctx) {
    if (!template.inst) {
        console.log('Error: Cannot call incrementalRerender on an uninstantiated template!');
        return;
    }
    var exprVal, instTmpl, tempNode;
    if (ctx === undefined)
        ctx = {};
    switch (template.type) {
        case 'string':
            return template;
        case 'root':
            iterateThroughNestedTmpls(template, ctx);
            return template;
        case 'html':
            exprVal = evalInContext(template.expr, ctx).toString();
            if (exprVal !== template.currentVal) {
                tempNode = document.createElement(template.htmlTagType);
                tempNode.innerHTML = exprVal;
                template.getnoderef().parentNode.replaceChild(tempNode, template.getnoderef());
                tempNode.id = template.id;
                template.noderef = tempNode;
                template.currentVal = exprVal;
            }
            return template;
        case 'text':
            exprVal = evalInContext(template.expr, ctx).toString();
            if (exprVal !== template.currentVal) {
                /* Changing nodeValue of a text node is much faster than changing innerHTML */
                template.getnoderef().childNodes[0].nodeValue = exprVal;
                template.currentVal = exprVal;
            }
            return template;
        case 'if':
            exprVal = !!evalInContext(template.expr, ctx);
            if (exprVal === template.currentVal) {
                if (exprVal) /* Only need to iterate through nested templates if they're actually displayed */
                    iterateThroughNestedTmpls(template, ctx);
                return template;
            } else if (exprVal) {
                instTmpl = htmlRender(template, ctx);
                template.getnoderef().innerHTML = instTmpl.text;
                return instTmpl.instTmpl;
            } else {
                template.getnoderef().innerHTML = '';
                template.currentVal = exprVal;
                template.instTmplList = [];
                return template;
            }
        case 'for':
            exprVal = evalInContext(template.expr, ctx);

            var startMatchPosOld, startMatchPosNew, endMatchPosOld, endMatchPosNew;
            var start = 0, end = exprVal.length - 1;
            var currMatchedPos = exprVal.length - 1, lastMatchedPos = -2;
            var newPos;
            /* Attempt to match the new and old lists from the beginning of the list. */
            while (start < LIST_MATCH_TRAVERSE_FRACTION*exprVal.length && start < LIST_MATCH_MAX_CHECK) {
                if ((newPos = template.forMap[getKey(exprVal[start])]) === undefined) {
                    lastMatchedPos = -2;
                } else if (newPos === lastMatchedPos + 1) {
                    /* Found multiple items in a row */
                    if (newPos - currMatchedPos >= LIST_MATCH_SEQUENTIAL_LENGTH) {
                        /* Found sufficient number of sequential matching items */
                        startMatchPosOld = currMatchedPos;
                        startMatchPosNew = start - LIST_MATCH_SEQUENTIAL_LENGTH;
                        break;
                    } else {
                        lastMatchedPos = newPos;
                    }
                } else {
                    currMatchedPos = newPos;
                    lastMatchedPos = newPos;
                }
                start++;
            }
            /* Repeat above from the end of the list, again attempting to match */
            while (end > (exprVal.length*(1 - LIST_MATCH_TRAVERSE_FRACTION)) && end > (exprVal.length - LIST_MATCH_MAX_CHECK)) {
                if ((newPos = template.forMap[getKey(exprVal[end])]) === undefined) {
                    lastMatchedPos = -2;
                } else if (newPos === lastMatchedPos - 1) {
                    /* Found multiple items in a row */
                    if (currMatchedPos - newPos >= LIST_MATCH_SEQUENTIAL_LENGTH) {
                        /* Found sufficient number of sequential matching items */
                        endMatchPosOld = currMatchedPos;
                        endMatchPosNew = end + LIST_MATCH_SEQUENTIAL_LENGTH;
                        break;
                    } else {
                        lastMatchedPos = newPos;
                    }
                } else {
                    currMatchedPos = newPos;
                    lastMatchedPos = newPos;
                }
                end--;
            }
            var i, innerWrapper, value, oldForCtxVal, oldIdx, newIdx, nextNode, nodeToDelete, newInstTmpl;
            var instTmplLists = [], forDomIds = [], forDomElements = [], forMap = {};
            if (endMatchPosOld === undefined || startMatchPosOld === undefined
                || (endMatchPosOld - startMatchPosOld) !== (endMatchPosNew - startMatchPosNew)) {
                /* No match found, or the match isn't fully valid because the amount of content within the match
                 * is inconsistent, but attempt to reuse existing content */
                oldForCtxVal = ctx[template.forvar];
                for (i = 0; i < exprVal.length && i < template.currentVal; i++) {
                    value = exprVal[i];

                    if (forMap[getKey(value)] !== undefined) {
                        console.log('ERROR: Cannot have multiple values mapping to the same value in a for-loop!');
                        continue;
                    }
                    forMap[getKey(value)] = i;
                    forDomIds[i] = template.forDomIds[i];
                    forDomElements[i] = template.forDomElements[i];

                    instTmplLists[i] = template.instTmplList[i].map(function (innerTmpl) {
                        ctx[template.forvar] = value;
                        newInstTmpl = incrementalRerender(innerTmpl, ctx);
                        return newInstTmpl;
                    });
                }

                /* If length doesn't match, delete or insert as necessary */
                if (exprVal.length !== template.currentVal) {
                    if (exprVal.length > template.currentVal) {
                        /* Insert */
                        var textStrings = [];
                        for (i = template.currentVal; i < exprVal.length; i++) {
                            value = exprVal[i];
                            instTmpl = tmplToInstTmplStringAndList(template, ctx, value);
                            innerWrapper = wrapWithID(instTmpl.string, template.htmlTagType);
                            instTmplLists[i] = instTmpl.list;
                            forDomIds[i] = innerWrapper.id;
                            textStrings.push(innerWrapper.text);
                            if (forMap[getKey(value)] !== undefined)
                                console.log('ERROR: Cannot have multiple values mapping to the same value in a for-loop!');
                            forMap[getKey(value)] = i;
                        }
                        template.getnoderef().insertBefore(documentFragFromHTML(textStrings.join('')), template.getcommentendnoderef());
                    } else if (exprVal.length < template.currentVal) {
                        /* Delete */
                        nodeToDelete = template.getfornoderef(exprVal.length);
                        while (nodeToDelete !== template.getcommentendnoderef()) {
                            nextNode = nodeToDelete.nextSibling;
                            template.getnoderef().removeChild(nodeToDelete);
                            nodeToDelete = nextNode;
                        }
                    }
                }

                ctx[template.forvar] = oldForCtxVal;
                template.forDomElements = forDomElements;
                template.forDomIds = forDomIds;
                template.instTmplList = instTmplLists;
                template.forMap = forMap;
                template.currentVal = exprVal.length;
            } else if ((endMatchPosOld - startMatchPosOld) === (endMatchPosNew - startMatchPosNew)) {
                /* Found a good match */
                if (startMatchPosOld !== 0 || endMatchPosOld+1 !== template.currentVal) {
                    /* Remove old elements at the start */
                    for (i = 0; i < startMatchPosOld; i++) {
                        template.getnoderef().removeChild(template.getfornoderef(i));
                    }
                    /* Remove old elements at the end */
                    for (i = endMatchPosOld + 1; i < template.currentVal; i++) {
                        template.getnoderef().removeChild(template.getfornoderef(i));
                    }
                }

                var startString = '', endString = '';
                /* Add new elements at start and end */
                for (i = 0; i < exprVal.length; i++) {
                    if (i === startMatchPosNew) {
                        /* Skip the elements between the two match positions */
                        i = endMatchPosNew;
                        continue;
                    }
                    value = exprVal[i];
                    instTmpl = tmplToInstTmplStringAndList(template, ctx, value);
                    innerWrapper = wrapWithID(instTmpl.string, template.htmlTagType);
                    instTmplLists[i] = instTmpl.list;
                    forDomIds[i] = innerWrapper.id;
                    if (i < startMatchPosNew)
                        startString += innerWrapper.text;
                    else
                        endString += innerWrapper.text;
                    if (forMap[getKey(value)] !== undefined)
                        console.log('ERROR: Cannot have multiple values mapping to the same value in a for-loop!');
                    forMap[getKey(value)] = i;
                }
                if (startString !== '')
                    template.getnoderef().insertBefore(documentFragFromHTML(startString),
                        template.getcommentstartnoderef().nextSibling);
                if (endString !== '')
                    template.getnoderef().insertBefore(documentFragFromHTML(endString),
                        template.getcommentendnoderef());

                /* This loop assumes that (endMatchPosOld - startMatchPosOld) == (endMatchPosNew - startMatchPosNew)
                 * (which we checked up above) */
                oldForCtxVal = ctx[template.forvar];
                for (i = startMatchPosOld; i <= endMatchPosOld; i++) {
                    oldIdx = i;
                    newIdx = i + (startMatchPosNew - startMatchPosOld);
                    value = exprVal[newIdx];

                    if (forMap[getKey(value)] !== undefined) {
                        console.log('ERROR: Cannot have multiple values mapping to the same value in a for-loop!');
                        return {text: '', instTmpl: undefined};
                    }
                    forMap[getKey(value)] = newIdx;
                    forDomIds[newIdx] = template.forDomIds[oldIdx];
                    forDomElements[newIdx] = template.forDomElements[oldIdx];

                    instTmplLists[newIdx] = template.instTmplList[oldIdx].map(function (innerTmpl) {
                        ctx[template.forvar] = value;
                        newInstTmpl = incrementalRerender(innerTmpl, ctx);
                        return newInstTmpl;
                    });
                }
                ctx[template.forvar] = oldForCtxVal;
                template.forDomElements = forDomElements;
                template.forDomIds = forDomIds;
                template.instTmplList = instTmplLists;
                template.forMap = forMap;
                template.currentVal = exprVal.length;
            } else {
                /* This should never be reached */
                console.log("Error occurred while processing for-loop");
            }
            return template;
    }
}

/* Helper function for htmlRender. Takes in a template TMPL and context CTX, and returns
 * a string consisting of the concatenation of all of the templates contained within,
 * as well as a list of all of the corresponding instantiated templates. FORVARVALUE
 * is used for for-templates; if specified, it will be put into the context
 * when evaluating the inner templates.
 */
function tmplToInstTmplStringAndList(tmpl, ctx, forVarValue) {
    var instTmpl, oldForCtxVal, instTmplStrings = [], instTmplList = [];
    if (tmpl.forvar !== undefined) {
        oldForCtxVal = ctx[tmpl.forvar];
        ctx[tmpl.forvar] = forVarValue;
    }
    tmpl.tmplList.forEach(function (innerTmpl) {
        instTmpl = htmlRender(innerTmpl, ctx);
        instTmplStrings.push(instTmpl.text);
        /* Since string templates won't ever change, we don't actually
         * need to store them in the instantiated template list */
        if (instTmpl.type != 'string')
            instTmplList.push(instTmpl.instTmpl);
    });
    if (tmpl.forvar !== undefined)
        ctx[tmpl.forvar] = oldForCtxVal;
    return {string: instTmplStrings.join(''), list: instTmplList};
}

/* For use in for loops, in which items are tracked by a unique key.
*  RETURNS a key which, for a string or number, is just the value. For
*          an object, it is a unique key stored within the object. */
var getKey = (function() {
    var uniqueID = 0;
    return function(value) {
        if (typeof value === 'string' || typeof value === "number") {
            return value;
        } else if (typeof value === "object") {
            if (value.$$forKey === undefined)
                value.$$forKey = "for-key-" + uniqueID++;
            return value.$$forKey;
        } else {
            console.log("Error: In getKey(), asked for key of something with typeof = " + typeof value);
            return "";
        }
    }
})();

/* Perform a full HTML render for the given template using the given context (empty context if none
 * is specified).
 * TEMPLATE: The template to render. This will not be modified.
 * CTX: Context to evaluate within.
 * RETURNS an object containing the full HTML string (text field) and the instantiated template (instTmpl field) */
function htmlRender(template, ctx) {
    var exprVal, wrapper, instTmpl;
    if (ctx === undefined)
        ctx = {};
    switch (template.type) {
        case 'string':
            return {text: template.expr, instTmpl: template.instantiate(getNextID())};
        case 'root':
            instTmpl = tmplToInstTmplStringAndList(template, ctx);
            if (template.inst)
                wrapper = {id: template.id, text: instTmpl.string};
            else
                wrapper = wrapWithID(instTmpl.string, template.htmlTagType);
            return {text: wrapper.text, instTmpl: template.instantiate(wrapper.id, null, instTmpl.list)};
        case 'html':
        case 'text':
            exprVal = evalInContext(template.expr, ctx).toString();
            if (template.type === 'text') {
                /* using HTML escaping here since we can't directly modify the text node's nodeValue (it doesn't exist yet) */
                exprVal = (exprVal.toString()).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                                 .replace(/</g, '&lt;' ).replace(/>/g, '&gt;');
            }
            if (template.inst)
                wrapper = {id: template.id, text: instTmpl.string};
            else
                wrapper = wrapWithID(exprVal, template.htmlTagType);
            return {text: wrapper.text, instTmpl: template.instantiate(wrapper.id, exprVal)};
        case 'if':
            exprVal = !!evalInContext(template.expr, ctx);
            if (exprVal)
                instTmpl = tmplToInstTmplStringAndList(template, ctx);
            if (template.inst)
                wrapper = {id: template.id, text: instTmpl.string};
            else
                wrapper = wrapWithID(instTmpl ? instTmpl.string : '', template.htmlTagType);
            return {text: wrapper.text, instTmpl: template.instantiate(wrapper.id, exprVal, instTmpl ? instTmpl.list : [])};
        case 'for':
            var instTmplStringsCombined, instTmplStrings = [], instTmplLists = [], forDomIds = [], forMap = {}, pos = 0, hasCommentNodes, innerWrapper;
            exprVal = evalInContext(template.expr, ctx);
            exprVal.forEach(function (value) {
                if (forMap[getKey(value)] !== undefined) {
                    console.log('ERROR: Cannot have multiple values mapping to the same value in a for-loop!');
                    return;
                }
                forMap[getKey(value)] = pos++;
                instTmpl = tmplToInstTmplStringAndList(template, ctx, value);
                innerWrapper = wrapWithID(instTmpl.string, template.htmlTagType);
                instTmplStrings.push(innerWrapper.text);
                instTmplLists.push(instTmpl.list);
                forDomIds.push(innerWrapper.id);
            });
            instTmplStringsCombined = instTmplStrings.join('');
            if (template.inst) {
                hasCommentNodes = template.hasCommentNodes;
                wrapper = {id: template.id, text: instTmplStringsCombined};
            } else {
                var id = getNextID();
                if (exprVal === undefined || exprVal.length === 0) {
                    /* Won't have reference nodes to use to insert later, place the comment nodes now */
                    wrapper = {id: id, text: '<!--for-loop-start-' + id + '--><!--for-loop-end-' + id + '-->'};
                    hasCommentNodes = true;
                } else {
                    /* Insert comment nodes later to ensure that they get placed immediately before/after list elements */
                    wrapper = {id: id, text: instTmplStringsCombined};
                    hasCommentNodes = false;
                }
            }
            return {text: wrapper.text, instTmpl: template.instantiate(wrapper.id, exprVal.length, instTmplLists, forDomIds, forMap, hasCommentNodes)};
    }
}

/* Compiles a markup string into a Template object.
 * MARKUP: Markup string containing template sites and HTML.
 * RETURNS an uninstantiated Template. */
function compile(markup) {
    // ===== nested function =======
    function parseFn(match, htmltagtype, tagtype, forvar, expr, offset, string) {
        nestedTmpls.push(new Template('string', string.substring(parseLoc, offset)));
        parseLoc = offset + match.length;

        if (tagtype === undefined || tagtype === 'text') {
            nestedTmpls.push(new Template(tagtype || 'html', fnFromString(expr), htmltagtype));
        } else if (tagtype === 'if' || tagtype.substring(0,3) === 'for') {
            stack.push(current);
            current = new Template(tagtype === 'if' ? 'if' : 'for', fnFromString(expr), htmltagtype);
            if (tagtype !== 'if') {
                current.forvar = forvar;
            }
            nestedTmpls.push(current);
            nestedTmpls = current.tmplList;
        } else if (tagtype === '/if' || tagtype === '/for') {
            if (current.type !== tagtype.substring(1))
                console.log('Error, found a mismatched closing tag of type <' + tagtype +
                            '> when expecting </' + current.type + '>');
            current = stack.pop();
            nestedTmpls = current.tmplList;
        } else {
            console.log('Error, found unrecognized tagtype of <' + tagtype + '>');
        }

        return match;
    }
    // ===== end nested function ===

    var root, current, nestedTmpls, stack = [], parseLoc = 0;
    root = new Template('root', null, 'div');
    stack.push(root);
    current = root;
    nestedTmpls = root.tmplList;
    markup.replace(rParse, parseFn);
    nestedTmpls.push(new Template('string', markup.substring(parseLoc, markup.length)));
    return root;
}
