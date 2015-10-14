"use strict";

var ReactDOMServer = require('react-dom/server');
var Flux = require("../client/flux");
var ActionListeners = require("alt/utils/ActionListeners");
var fetchConversions = require("../client/utils/api").fetchConversions;

// Return query bootstrap information or `null`.
var _getQueryBootstrap = function (req) {
  // Check query string.
  var bootstrap = req.query.__bootstrap;
  if (!bootstrap) { return null; }

  // Check have all parts.
  var parts = bootstrap.split(":");
  var types = parts[0];
  var value = parts[1];
  if (!types) { return null; }

  return {
    types: types,
    value: value
  };
};

module.exports.flux = {
  /**
   * "Fetch first" strategy middleware with **singleton**.
   *
   * Use the underlying API to fetch data and then manually `bootstrap`.
   *
   * The advantages of this approach are:
   *
   * - It doesn't add extra listeners, instead going straight to the source.
   * - More efficient with a singleton flux instance.
   *
   * The disadvantages of this approach are:
   *
   * - There is separate logic for retrieving data on the server vs. the client.
   * - All flux interaction has to be `synchronous` because it's a singleton.
   *   (But that part can be easily changed).
   *
   * **Flux Singleton**: This middleware uses a single flux instance across
   * all requests, which means that our sequence of:
   *
   * - `alt.bootstrap(DATA)`
   * - `alt.takeSnapshot()`
   * - React component render
   * - `alt.flush()`
   *
   * Has to be synchronous and complete in the immediate thread before handing
   * control back to another event.
   *
   * @param   {Object}    Component React component to render.
   * @returns {Function}            middleware function
   */
  fetch: function (Component) {
    // Flux singleton for atomic actions.
    var flux = new Flux();

    return function (req, res, next) {
      // Skip if not server-rendering
      if (req.query.__mode === "noss") { return next(); }

      // Check query string.
      var queryBootstrap = _getQueryBootstrap(req);
      if (!queryBootstrap) { return next(); }
      var types = queryBootstrap.types;
      var value = queryBootstrap.value;

      // Fetch from localhost.
      fetchConversions(types, value)
        .then(function (conversions) {
          // Bootstrap, snapshot data to res.locals and flush for next request.
          flux.bootstrap(JSON.stringify({
            ConvertStore: {
              conversions: conversions,
              types: types,
              value: value
            }
          }));

          // Stash bootstrap, and _fully-rendered-page_ with proper data.
          res.locals.bootstrapData = flux.takeSnapshot();
          if (req.query.__mode !== "noss") {
            // **Note**: Component rendering could be made much more generic
            // with a simple callback of `function (flux)` that the upstream
            // component can use however it wants / ignore.
            res.locals.bootstrapComponent =
              ReactDOMServer.renderToString(new Component({ flux: flux }));
          }

          // Restore for next request.
          flux.flush();

          next();
        })
        .catch(function (err) { next(err); });
    };
  },

  /**
   * "Actions" strategy middleware.
   *
   * Use store actions and listeners to inflate the store.
   *
   * The advantages of this approach are:
   *
   * - Uses the _exact same_ series of actions to inflate store as client.
   *
   * The disadvantages of this approach are:
   *
   * - Adds extra listeners in a slightly complicated way.
   * - Cannot use flux singletons.
   *
   * **Flux Instance**: This middleware creates ephemeral flux instances to
   * allow async actions free reign to mutate store state before snapshotting.
   * The work sequence is:
   *
   * - Create new `flux` instance.
   * - Set `ActionListeners` on appropriate events.
   * - Invoke the necessary action(s) to inflate the store.
   * - Snapshot the store data.
   * - Clean up the flux instance, listeners, etc.
   *
   * @param   {Object}    Component React component to render.
   * @returns {Function}            middleware function
   */
  actions: function (Component) {
    return function (req, res, next) {
      /*eslint max-statements:[2, 20] */
      // Skip if not server-rendering
      if (req.query.__mode === "noss") { return next(); }

      // Check query string.
      var queryBootstrap = _getQueryBootstrap(req);
      if (!queryBootstrap) { return next(); }
      var types = queryBootstrap.types;
      var value = queryBootstrap.value;

      // Flux instance for this single request / callback.
      var flux = new Flux();
      var listener = new ActionListeners(flux);
      var actions = flux.getActions("ConvertActions");

      // Wrap cleanup methods.
      var _done = function (err) {
        listener.removeAllActionListeners();
        flux.flush();
        next(err);
      };

      // ----------------------------------------------------------------------
      // Listeners
      // ----------------------------------------------------------------------
      // **Strategy**: Execute a series of Flux Actions that end with the
      // correct data store results we can snapshot.
      //
      // There's only one listener here, but it could be a series that would
      // at the end result in this callback.
      listener.addActionListener(actions.UPDATE_CONVERSIONS, function () {
        // Ignore actual result, instead relying on being "done" with actions.
        // Snapshot data results.
        res.locals.bootstrapData = flux.takeSnapshot();

        // Pre-render page if applicable.
        if (req.query.__mode !== "noss") {
          res.locals.bootstrapComponent =
            ReactDOMServer.renderToString(new Component({ flux: flux }));
        }

        _done();
      });

      // Error-handling.
      listener.addActionListener(actions.CONVERSION_ERROR, _done);

      // ----------------------------------------------------------------------
      // Actions
      // ----------------------------------------------------------------------
      // The rub here is that we have to remember and invoke _all_ of the
      // actions that will leave us in the proper state.

      // Invoke sync actions.
      actions.setConversionTypes(types);
      actions.setConversionValue(value);

      // Invoke async actions.
      actions.fetchConversions(types, value);
    };
  }
};
