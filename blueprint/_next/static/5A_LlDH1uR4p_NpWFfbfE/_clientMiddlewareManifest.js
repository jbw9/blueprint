self.__MIDDLEWARE_MATCHERS = [
  {
    "regexp": "^\\/blueprint(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!api\\/credit\\/relay|_next\\/static|_next\\/image).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$",
    "originalSource": "/((?!api/credit/relay|_next/static|_next/image).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()